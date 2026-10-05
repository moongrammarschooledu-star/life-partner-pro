#!/usr/bin/env node
/**
 * Admin account recovery — run by the OWNER on their own machine, against the database named in .env.
 * Use it when the e-mailed reset code cannot reach the admin (wrong/undeliverable address, no other Super Admin).
 *
 *   node scripts/admin-recovery.mjs list
 *       Shows every admin account: e-mail, role, active, 2FA. Never prints password hashes.
 *   node scripts/admin-recovery.mjs reset <admin-email>
 *       Prompts (hidden) for a new password twice, sets it, clears the forced-reset flag, signs out every session of that
 *       admin and writes an audit entry. Asks you to confirm the database host first.
 *   node scripts/admin-recovery.mjs set-email <current-email> <new-email>
 *       Changes the admin's e-mail (so e-mailed reset codes and 2FA codes reach a real mailbox).
 *   node scripts/admin-recovery.mjs create <email>
 *       Creates the first Super Admin when the database has no admin at all (refuses if any admin already exists).
 *       Prompts (hidden) for the password twice; 2FA by e-mailed code is switched on for the account.
 *
 * The password is read from the terminal only (never from arguments, never printed, never logged).
 */
import { readFileSync, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

// Minimal .env loader (no extra dependency). Existing process env wins.
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

const MIN_LENGTH = 10;
// --show: the password is displayed while typing (for terminals where hidden input misbehaves). Use only on your own screen.
const SHOW = process.argv.includes("--show");
const prisma = new PrismaClient();

function dbHost() {
  try {
    return new URL(process.env.DATABASE_URL).host;
  } catch {
    return "(unreadable DATABASE_URL)";
  }
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden && !SHOW) {
      // Mute echo of the typed characters.
      rl._writeToOutput = (s) => { if (s.startsWith(question)) process.stdout.write(s); };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function list() {
  const admins = await prisma.adminUser.findMany({ select: { email: true, name: true, role: true, active: true, twoFactorEnabled: true, mustResetPassword: true, lastLoginAt: true }, orderBy: { createdAt: "asc" } });
  console.log(`\nDatabase host: ${dbHost()}\n`);
  if (!admins.length) return console.log("No admin accounts found.");
  for (const a of admins) {
    console.log(`- ${a.email}  |  ${a.name}  |  ${a.role}  |  ${a.active ? "active" : "INACTIVE"}  |  2FA ${a.twoFactorEnabled ? "on" : "off"}  |  last login ${a.lastLoginAt ? a.lastLoginAt.toISOString() : "never"}${a.mustResetPassword ? "  |  must reset password" : ""}`);
  }
  console.log("");
}

async function findAdmin(email) {
  const admin = await prisma.adminUser.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!admin) {
    console.error(`No admin with e-mail "${email}". Run "list" to see the exact addresses.`);
    process.exit(1);
  }
  return admin;
}

async function audit(adminId, meta) {
  await prisma.auditLog.create({ data: { action: "ADMIN_USER_PASSWORD_RESET", adminId, meta: JSON.stringify(meta) } });
}

async function reset(email) {
  const admin = await findAdmin(email);
  console.log(`\nAbout to set a NEW PASSWORD for ${admin.email} (${admin.role}) on database host: ${dbHost()}`);
  if ((await ask('Type "yes" to continue: ')).trim().toLowerCase() !== "yes") return console.log("Cancelled. Nothing was changed.");

  const a = await ask(`New password (min ${MIN_LENGTH} characters): `, { hidden: true });
  const b = await ask("Repeat new password: ", { hidden: true });
  if (a !== b) return console.error("The two passwords do not match. Nothing was changed.");
  if (a.length < MIN_LENGTH || a.length > 128) return console.error(`The password must be ${MIN_LENGTH}–128 characters. Nothing was changed.`);

  const passwordHash = await bcrypt.hash(a, 12);
  await prisma.adminUser.update({ where: { id: admin.id }, data: { passwordHash, mustResetPassword: false, active: true } });
  const revoked = await prisma.adminSession.updateMany({ where: { adminId: admin.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(admin.id, { stage: "recovery_script", self: false, sessionsRevoked: revoked.count });
  console.log(`\nDone. The password for ${admin.email} was changed and ${revoked.count} session(s) were signed out.`);
  console.log("Sign in at /admin/login. If 2FA is on, the login code is e-mailed to the address above — make sure it is a real mailbox (use set-email if not).");
}

async function setEmail(current, next) {
  const admin = await findAdmin(current);
  const e = next.trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,255}$/.test(e)) return console.error("That is not a valid e-mail address.");
  if (await prisma.adminUser.findUnique({ where: { email: e } })) return console.error("Another admin already uses that e-mail.");
  console.log(`\nAbout to change the e-mail of ${admin.email} to ${e} on database host: ${dbHost()}`);
  if ((await ask('Type "yes" to continue: ')).trim().toLowerCase() !== "yes") return console.log("Cancelled. Nothing was changed.");
  await prisma.adminUser.update({ where: { id: admin.id }, data: { email: e } });
  await audit(admin.id, { stage: "recovery_script_email_change" });
  console.log(`Done. ${admin.email} is now ${e}.`);
}

async function create(email) {
  const e = email.trim().toLowerCase();
  if (!/^[^s@]{1,64}@[^s@]{1,255}$/.test(e)) return console.error("That is not a valid e-mail address.");
  const existing = await prisma.adminUser.count();
  if (existing > 0) return console.error(`This database already has ${existing} admin account(s). Use "list", then "reset" or "set-email" instead. Nothing was changed.`);
  console.log(`
About to CREATE the first Super Admin ${e} on database host: ${dbHost()}`);
  if ((await ask('Type "yes" to continue: ')).trim().toLowerCase() !== "yes") return console.log("Cancelled. Nothing was changed.");

  const a = await ask(`Password for the new admin (min ${MIN_LENGTH} characters): `, { hidden: true });
  const b = await ask("Repeat password: ", { hidden: true });
  if (a !== b) return console.error("The two passwords do not match. Nothing was changed.");
  if (a.length < MIN_LENGTH || a.length > 128) return console.error(`The password must be ${MIN_LENGTH}–128 characters. Nothing was changed.`);

  const passwordHash = await bcrypt.hash(a, 12);
  const admin = await prisma.adminUser.create({ data: { name: "Super Admin", email: e, passwordHash, role: "SUPER_ADMIN", twoFactorEnabled: true, active: true, mustResetPassword: false } });
  await prisma.auditLog.create({ data: { action: "ADMIN_USER_CREATED", adminId: admin.id, meta: JSON.stringify({ stage: "recovery_script_first_admin", role: "SUPER_ADMIN" }) } });
  console.log(`
Done. Super Admin ${e} was created. Sign in at /admin/login; the login code will be e-mailed to this address.`);
}

const [cmd, a1, a2] = process.argv.slice(2).filter((x) => x !== "--show");
try {
  if (cmd === "list") await list();
  else if (cmd === "reset" && a1) await reset(a1);
  else if (cmd === "set-email" && a1 && a2) await setEmail(a1, a2);
  else if (cmd === "create" && a1) await create(a1);
  else console.log("Usage:\n  node scripts/admin-recovery.mjs list\n  node scripts/admin-recovery.mjs reset <admin-email>\n  node scripts/admin-recovery.mjs set-email <current-email> <new-email>\n  node scripts/admin-recovery.mjs create <email>   (only when there is no admin at all)\n  Add --show to see the password while typing.");
} catch (error) {
  console.error("Failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

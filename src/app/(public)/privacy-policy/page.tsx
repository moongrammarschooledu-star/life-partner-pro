export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="font-heading text-3xl font-semibold">Privacy Policy</h1>
      <div className="prose mt-6 space-y-4 text-sm leading-relaxed text-muted">
        <p>
          Life Partner Pro is a private matchmaking service. Information you submit — including your personal,
          family, professional, and partner-preference details — is stored securely and is <strong className="text-foreground">not
          publicly visible or searchable</strong> in any form.
        </p>
        <p>
          Your profile is accessible only to authorized administrators, who review it for the purpose of identifying
          and facilitating suitable matrimonial matches. Contact information (phone, WhatsApp, email) is never shared
          with another profile without an administrator&apos;s explicit approval, which is recorded in an audit log
          together with who approved it and when.
        </p>
        <p>
          You may request an update to your profile at any time, and updates to sensitive fields are reviewed by an
          administrator before going live. You may also request complete removal of your profile from our system by
          contacting an administrator.
        </p>
        <p>
          We do not sell or share your data with third parties. Photos you upload are stored securely and are only
          ever viewed by authorized administrators.
        </p>
      </div>
    </div>
  );
}

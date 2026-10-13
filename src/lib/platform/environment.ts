import { ApiError } from "@/lib/route-guard";
import { currentEnvironment, ENVIRONMENT_LABEL, type PlatformEnvironment } from "@/lib/platform/environment-core";

// Environment separation (STEP 36 §55). Every deployment (development, staging, production) has its own database, so one environment cannot edit
// another's configuration. What this adds is protection against a mistake inside the right database: a configuration write must NAME the environment
// it intends to change, and the server refuses it unless that is the environment it is running in. The control center shows the environment on every page.

export { currentEnvironment, ENVIRONMENT_LABEL, type PlatformEnvironment };

type EnvMap = Record<string, string | undefined>;

/** `requested` is what the administrator selected in the screen (or sent to the API). Missing or different from the running environment is refused. */
export function assertEnvironmentMatches(requested: unknown, env: EnvMap = process.env): PlatformEnvironment {
  const running = currentEnvironment(env);
  const named = typeof requested === "string" ? requested.trim().toUpperCase() : "";
  if (!named) throw new ApiError(400, `Name the environment you are changing (this one is ${ENVIRONMENT_LABEL[running]}).`);
  if (named !== running) throw new ApiError(409, `This is the ${ENVIRONMENT_LABEL[running]} environment, not ${named.slice(0, 20)}. Nothing was changed.`);
  return running;
}
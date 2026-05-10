/**
 * Dockerode wrapper: chooses the right transport for the current OS so the
 * same controller binary works on Windows (named pipe), macOS, and Linux
 * (Unix socket).
 *
 * SERVER ONLY.
 */
import Docker from "dockerode";

function dockerOptions(): Docker.DockerOptions {
  // Allow override (CI, custom socket, remote daemon over TCP).
  if (process.env.DOCKER_HOST) {
    return {}; // dockerode picks DOCKER_HOST up automatically
  }
  if (process.platform === "win32") {
    return { socketPath: "//./pipe/docker_engine" };
  }
  return { socketPath: "/var/run/docker.sock" };
}

let cached: Docker | null = null;

export function getDocker(): Docker {
  if (!cached) cached = new Docker(dockerOptions());
  return cached;
}

/** Pings the daemon. Throws a friendly error if it cannot be reached. */
export async function pingDocker(): Promise<void> {
  try {
    await getDocker().ping();
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Docker daemon is not reachable (${detail}). ` +
        "Make sure Docker Desktop is running.",
    );
  }
}

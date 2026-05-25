const HOSTS = [
  process.argv[2] || process.env.CAMERA_CONTROL_CAM1_HOST || "192.168.1.165",
  process.argv[3] || process.env.CAMERA_CONTROL_CAM2_HOST || "192.168.1.166",
  process.argv[4] || process.env.CAMERA_CONTROL_CAM3_HOST || "192.168.1.167",
];

const ENDPOINTS = [
  { path: "/system" },
  { path: "/system/format" },
  { path: "/lens/focus" },
  { path: "/lens/iris" },
  { path: "/camera/tallyStatus", optional: true },
];

const TIMEOUT_MS = Number(process.env.CAMERA_CONTROL_TEST_TIMEOUT_MS || 2000);

async function main() {
  let failed = false;
  for (const host of HOSTS) {
    console.log(`\n=== ${host} ===`);
    for (const endpoint of ENDPOINTS) {
      const result = await getCameraEndpoint(host, endpoint.path);
      if (!result.ok && !endpoint.optional) failed = true;
      const label = result.ok ? "ok" : endpoint.optional ? "optional" : "fail";
      console.log(`${endpoint.path} ${label} ${result.status || ""} ${result.summary || result.error || ""}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

async function getCameraEndpoint(host, endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`http://${host}/control/api/v1${endpoint}`, {
      method: "GET",
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      summary: summarize(text),
    };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function summarize(text) {
  if (!text) return "";
  try {
    const json = JSON.parse(text);
    return JSON.stringify(json).slice(0, 140);
  } catch {
    return text.replace(/\s+/g, " ").slice(0, 140);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

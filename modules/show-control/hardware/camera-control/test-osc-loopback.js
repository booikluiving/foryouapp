const osc = require("../common/osc-compat");

const HOST = process.env.V2_SHOW_CONTROL_CAMERA_OSC_TEST_HOST || "127.0.0.1";
const PORT = Number(process.env.V2_SHOW_CONTROL_CAMERA_OSC_PORT || 53260);

const udp = new osc.UDPPort({
  localAddress: "127.0.0.1",
  localPort: 0,
  remoteAddress: HOST,
  remotePort: PORT,
  metadata: true,
});

udp.on("ready", () => {
  udp.send({
    address: "/camera/tally/cam1",
    args: [{ type: "s", value: "preview" }],
  });
  udp.send({
    address: "/camera/tally/cam1",
    args: [{ type: "s", value: "none" }],
  });
  console.log(`Sent tally loopback messages to ${HOST}:${PORT}`);
  setTimeout(() => {
    udp.close();
  }, 150);
});

udp.on("error", (error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
  try { udp.close(); } catch {}
});

udp.open();

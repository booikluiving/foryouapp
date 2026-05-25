"use strict";

const dgram = require("node:dgram");
const { EventEmitter } = require("node:events");

function pad4Length(length) {
  return length + ((4 - (length % 4)) % 4);
}

function stringBuffer(value) {
  const raw = Buffer.from(String(value == null ? "" : value), "utf8");
  const length = pad4Length(raw.length + 1);
  const buffer = Buffer.alloc(length);
  raw.copy(buffer, 0);
  return buffer;
}

function readOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  return {
    value: buffer.slice(offset, end).toString("utf8"),
    nextOffset: pad4Length(end + 1),
  };
}

function normalizeArg(arg) {
  if (arg && typeof arg === "object" && Object.prototype.hasOwnProperty.call(arg, "value")) {
    return {
      type: arg.type || (typeof arg.value === "number" ? "f" : "s"),
      value: arg.value,
    };
  }
  if (Number.isInteger(arg)) return { type: "i", value: arg };
  if (typeof arg === "number") return { type: "f", value: arg };
  return { type: "s", value: arg == null ? "" : String(arg) };
}

function argBuffer(arg) {
  if (arg.type === "i") {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(Number(arg.value || 0), 0);
    return buffer;
  }
  if (arg.type === "f") {
    const buffer = Buffer.alloc(4);
    buffer.writeFloatBE(Number(arg.value || 0), 0);
    return buffer;
  }
  return stringBuffer(arg.value);
}

function encodeOscMessage(message) {
  const args = (message.args || []).map(normalizeArg);
  return Buffer.concat([
    stringBuffer(message.address || "/"),
    stringBuffer(`,${args.map((arg) => arg.type).join("")}`),
    ...args.map(argBuffer),
  ]);
}

function decodeOscMessage(buffer, metadata = false) {
  const address = readOscString(buffer, 0);
  const typeTags = readOscString(buffer, address.nextOffset);
  const tags = typeTags.value.startsWith(",") ? typeTags.value.slice(1) : "";
  let offset = typeTags.nextOffset;
  const args = [];
  for (const tag of tags) {
    let value;
    if (tag === "s") {
      const decoded = readOscString(buffer, offset);
      value = decoded.value;
      offset = decoded.nextOffset;
    } else if (tag === "i") {
      value = buffer.readInt32BE(offset);
      offset += 4;
    } else if (tag === "f") {
      value = buffer.readFloatBE(offset);
      offset += 4;
    } else {
      throw new Error(`unsupported OSC type: ${tag}`);
    }
    args.push(metadata ? { type: tag, value } : value);
  }
  return {
    address: address.value,
    args,
  };
}

class UDPPort extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.socket = null;
  }

  open() {
    if (this.socket) return;
    this.socket = dgram.createSocket("udp4");
    this.socket.on("message", (buffer) => {
      try {
        this.emit("message", decodeOscMessage(buffer, !!this.options.metadata));
      } catch (err) {
        this.emit("error", err);
      }
    });
    this.socket.on("error", (err) => this.emit("error", err));
    this.socket.on("listening", () => this.emit("ready"));
    this.socket.bind(Number(this.options.localPort || 0), String(this.options.localAddress || "127.0.0.1"));
  }

  send(message, host, port) {
    if (!this.socket) this.open();
    const targetHost = host || this.options.remoteAddress || "127.0.0.1";
    const targetPort = Number(port || this.options.remotePort);
    const packet = encodeOscMessage(message);
    this.socket.send(packet, targetPort, targetHost, (err) => {
      if (err) this.emit("error", err);
    });
  }

  close() {
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    socket.close();
  }
}

module.exports = {
  UDPPort,
  decodeOscMessage,
  encodeOscMessage,
};

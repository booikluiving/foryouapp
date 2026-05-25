"use strict";

const dgram = require("node:dgram");

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

function encodeOscMessage(address, args = []) {
  const typeTags = `,${args.map(() => "s").join("")}`;
  return Buffer.concat([
    stringBuffer(address),
    stringBuffer(typeTags),
    ...args.map(stringBuffer),
  ]);
}

function readOscString(buffer, offset) {
  let end = offset;
  while (end < buffer.length && buffer[end] !== 0) end += 1;
  const value = buffer.slice(offset, end).toString("utf8");
  return {
    value,
    nextOffset: pad4Length(end + 1),
  };
}

function decodeOscMessage(buffer) {
  const address = readOscString(buffer, 0);
  const typeTags = readOscString(buffer, address.nextOffset);
  const tags = typeTags.value.startsWith(",") ? typeTags.value.slice(1) : "";
  let offset = typeTags.nextOffset;
  const args = [];
  for (const tag of tags) {
    if (tag !== "s") throw new Error(`show_control_osc_lite_unsupported_type:${tag}`);
    const arg = readOscString(buffer, offset);
    args.push(arg.value);
    offset = arg.nextOffset;
  }
  return {
    address: address.value,
    args,
  };
}

function sendOsc({ host, port, address, args }) {
  const socket = dgram.createSocket("udp4");
  const packet = encodeOscMessage(address, args);
  return new Promise((resolve, reject) => {
    socket.send(packet, Number(port), String(host), (err) => {
      socket.close();
      if (err) reject(err);
      else resolve();
    });
  });
}

function createOscServer({ host = "127.0.0.1", port, onMessage }) {
  const socket = dgram.createSocket("udp4");
  socket.on("message", (buffer, rinfo) => {
    try {
      onMessage(decodeOscMessage(buffer), rinfo);
    } catch (err) {
      onMessage({ address: "", args: [], error: err }, rinfo);
    }
  });
  socket.bind(Number(port), String(host));
  return {
    close() {
      try {
        socket.close();
      } catch (_err) {
        // Ignore shutdown races.
      }
    },
    socket,
  };
}

module.exports = {
  createOscServer,
  decodeOscMessage,
  encodeOscMessage,
  sendOsc,
};

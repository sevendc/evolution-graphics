export function parseToonGenome(text, minCount, maxCount) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trimEnd());
  const formatLine = lines.find((line) => line.trim().length > 0)?.trim();
  if (formatLine !== "format: form-signal-dna") {
    throw new Error("Unsupported TOON genome: expected `format: form-signal-dna`.");
  }
  if (!lines.some((line) => line.trim() === "version: 1")) {
    throw new Error("Unsupported TOON genome version. Expected version 1.");
  }
  const tableIndex = lines.findIndex((line) => /^triangles\[\d+\]\{[^}]+\}:$/.test(line.trim()));
  if (tableIndex < 0) {
    throw new Error("Could not find the TOON triangles table.");
  }
  const header = lines[tableIndex].trim().match(/^triangles\[(\d+)\]\{([^}]+)\}:$/);
  const count = Number(header[1]);
  const expectedFields = "ax,ay,bx,by,cx,cy,r,g,b,opacity";
  if (header[2] !== expectedFields) {
    throw new Error(`Unexpected TOON triangle columns. Expected: ${expectedFields}.`);
  }
  if (!Number.isInteger(count) || count < minCount || count > maxCount) {
    throw new Error(`TOON triangle count must be between ${minCount} and ${maxCount}.`);
  }
  const rows = lines.slice(tableIndex + 1).map((line) => line.trim()).filter(Boolean);
  if (rows.length !== count) {
    throw new Error(`TOON declares ${count} triangles but contains ${rows.length} data rows.`);
  }

  const genome = new Float32Array(count * 12);
  for (let i = 0; i < count; i += 1) {
    const parts = rows[i].split(",").map((part) => part.trim());
    const values = parts.map(Number);
    if (values.length !== 10 || parts.some((part) => !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(part))
      || values.some((value) => !Number.isFinite(value) || value > 1)) {
      throw new Error(`Invalid triangle data on TOON row ${i + 1}. Each row needs ten values from 0 to 1.`);
    }
    genome.set([
      values[0], values[1], values[6], values[7],
      values[2], values[3], values[8], values[9],
      values[4], values[5], 0, 0
    ], i * 12);
  }
  return { count, genome };
}

export function serializeToonGenome(raw, count, resolution, fitness) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    const offset = i * 12;
    const values = [
      raw[offset], raw[offset + 1],
      raw[offset + 4], raw[offset + 5],
      raw[offset + 8], raw[offset + 9],
      raw[offset + 2], raw[offset + 3], raw[offset + 6],
      raw[offset + 7]
    ];
    rows.push(`  ${values.map((value) => Number(value.toFixed(6))).join(",")}`);
  }
  return [
    "format: form-signal-dna",
    "version: 1",
    `workingResolution: ${resolution}`,
    `fitness: ${Number.isFinite(fitness) ? fitness.toFixed(6) : "null"}`,
    `triangles[${count}]{ax,ay,bx,by,cx,cy,r,g,b,opacity}:`,
    ...rows
  ].join("\n");
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(name) {
  return name.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-|-$/g, "") || "image";
}

const MAX_VERTICES = 16;
const SHAPE_FLOATS = MAX_VERTICES * 2 + 8;

export function parseToonGenome(text, minCount, maxCount) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trimEnd());
  const formatLine = lines.find((line) => line.trim().length > 0)?.trim();
  if (formatLine !== "format: form-signal-dna") {
    throw new Error("Unsupported TOON genome: expected `format: form-signal-dna`.");
  }
  const version = lines.find((line) => /^version:\s*\d+$/.test(line.trim()))?.trim();
  const tableIndex = lines.findIndex((line) => /^(?:triangles|shapes)\[\d+\]\{[^}]+\}:$/.test(line.trim()));
  if (tableIndex < 0) {
    throw new Error("Could not find the TOON shapes table.");
  }
  const header = lines[tableIndex].trim().match(/^(triangles|shapes)\[(\d+)\]\{([^}]+)\}:$/);
  const legacy = header[1] === "triangles";
  if ((legacy && version !== "version: 1") || (!legacy && version !== "version: 2")) {
    throw new Error("TOON shape table and version do not match.");
  }
  const expectedFields = legacy
    ? "ax,ay,bx,by,cx,cy,r,g,b,opacity"
    : "vertices,r,g,b,opacity,points";
  if (header[3] !== expectedFields) {
    throw new Error(`Unexpected TOON shape columns. Expected: ${expectedFields}.`);
  }
  const count = Number(header[2]);
  if (!Number.isInteger(count) || count < minCount || count > maxCount) {
    throw new Error(`TOON shape count must be between ${minCount} and ${maxCount}.`);
  }
  const rows = lines.slice(tableIndex + 1).map((line) => line.trim()).filter(Boolean);
  if (rows.length !== count) {
    throw new Error(`TOON declares ${count} shapes but contains ${rows.length} data rows.`);
  }

  const genome = new Float32Array(count * SHAPE_FLOATS);
  let maxVertices = 3;
  for (let i = 0; i < count; i += 1) {
    const parts = rows[i].split(",").map((part) => part.trim());
    const values = parts.map(Number);
    if (parts.some((part) => !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(part))
      || values.some((value, index) => !Number.isFinite(value)
        || (legacy || index > 0) && (value < 0 || value > 1))) {
      throw new Error(`Invalid shape data on TOON row ${i + 1}. Values must be between 0 and 1.`);
    }

    const offset = i * SHAPE_FLOATS;
    if (legacy) {
      if (values.length !== 10) {
        throw new Error(`Invalid triangle data on TOON row ${i + 1}. Each row needs ten values.`);
      }
      genome.set(values.slice(0, 6), offset);
      genome.set(values.slice(6, 10), offset + MAX_VERTICES * 2);
      genome[offset + MAX_VERTICES * 2 + 4] = 3;
      continue;
    }

    const vertexCount = values[0];
    if (!Number.isInteger(vertexCount) || vertexCount < 3 || vertexCount > MAX_VERTICES
      || values.length !== 5 + vertexCount * 2) {
      throw new Error(`Invalid polygon data on TOON row ${i + 1}. Provide 3-${MAX_VERTICES} points.`);
    }
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      genome[offset + vertex * 2] = values[5 + vertex * 2];
      genome[offset + vertex * 2 + 1] = values[6 + vertex * 2];
    }
    genome.set([values[1], values[2], values[3], values[4]], offset + MAX_VERTICES * 2);
    genome[offset + MAX_VERTICES * 2 + 4] = vertexCount;
    maxVertices = Math.max(maxVertices, vertexCount);
  }
  return { count, genome, maxVertices };
}

export function serializeToonGenome(raw, count, resolution, fitness) {
  const vertexCounts = Array.from({ length: count }, (_, index) => raw[index * SHAPE_FLOATS + MAX_VERTICES * 2 + 4]);
  const legacy = vertexCounts.every((vertexCount) => vertexCount === 3);
  const rows = [];
  const colorOffset = MAX_VERTICES * 2;
  for (let i = 0; i < count; i += 1) {
    const offset = i * SHAPE_FLOATS;
    const vertexCount = vertexCounts[i];
    if (legacy) {
      const values = [
        raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3], raw[offset + 4], raw[offset + 5],
        raw[offset + colorOffset], raw[offset + colorOffset + 1], raw[offset + colorOffset + 2], raw[offset + colorOffset + 3]
      ];
      rows.push(`  ${values.map((value) => Number(value.toFixed(6))).join(",")}`);
    } else {
      const values = [
        vertexCount,
        raw[offset + colorOffset], raw[offset + colorOffset + 1], raw[offset + colorOffset + 2], raw[offset + colorOffset + 3]
      ];
      for (let vertex = 0; vertex < vertexCount; vertex += 1) {
        values.push(raw[offset + vertex * 2], raw[offset + vertex * 2 + 1]);
      }
      rows.push(`  ${values.map((value) => Number(value.toFixed(6))).join(",")}`);
    }
  }
  return [
    "format: form-signal-dna",
    `version: ${legacy ? 1 : 2}`,
    `workingResolution: ${resolution}`,
    `fitness: ${Number.isFinite(fitness) ? fitness.toFixed(6) : "null"}`,
    legacy
      ? `triangles[${count}]{ax,ay,bx,by,cx,cy,r,g,b,opacity}:`
      : `shapes[${count}]{vertices,r,g,b,opacity,points}:`,
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

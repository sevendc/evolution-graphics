export const mutationShader = `
      struct Shape { points: array<vec2f, 16>, color: vec4f, properties: vec4f };
      struct Params { count: u32, population: u32, seed: u32, initial: u32, mutation: f32, guideReady: u32, batchStart: u32, batchCount: u32, structuralMutation: f32, focusEnabled: u32, focusProbability: f32, maxVertices: u32, focusMin: vec2f, focusMax: vec2f };
      const MAX_SHAPES: u32 = 512u;
      const MAX_VERTICES: u32 = 16u;
      @group(0) @binding(0) var<storage, read_write> candidate: array<Shape>;
      @group(0) @binding(1) var<storage, read> best: array<Shape>;
      @group(0) @binding(2) var<uniform> params: Params;
      @group(0) @binding(3) var<storage, read_write> bestCount: array<atomic<u32>>;
      @group(0) @binding(4) var<storage, read_write> candidateCounts: array<u32>;
      @group(0) @binding(5) var<storage, read> errorMap: array<f32>;
      @group(0) @binding(6) var targetImage: texture_2d<f32>;

      fn random01(value: u32) -> f32 {
        var x = value ^ (value >> 16u);
        x = x * 0x7feb352du;
        x = x ^ (x >> 15u);
        x = x * 0x846ca68bu;
        x = x ^ (x >> 16u);
        return f32(x) / 4294967295.0;
      }

      fn signedRandom(value: u32) -> f32 {
        return random01(value) * 2.0 - 1.0;
      }

      fn sourceTriangle(center: vec2f, pigment: vec3f, seed: u32, baseRadius: f32) -> Shape {
        let angle = random01(seed + 80u) * 6.2831853;
        let radius = baseRadius * (0.35 + random01(seed + 81u) * 1.3);
        let stretchX = 0.45 + random01(seed + 82u) * 1.4;
        let stretchY = 0.45 + random01(seed + 83u) * 1.4;
        let a = center + vec2f(cos(angle) * radius * stretchX, sin(angle) * radius * stretchY);
        let b = center + vec2f(cos(angle + 2.0943951) * radius * stretchX, sin(angle + 2.0943951) * radius * stretchY);
        let c = center + vec2f(cos(angle + 4.1887902) * radius * stretchX, sin(angle + 4.1887902) * radius * stretchY);
        var shape: Shape;
        shape.points[0] = clamp(a, vec2f(0.0), vec2f(1.0));
        shape.points[1] = clamp(b, vec2f(0.0), vec2f(1.0));
        shape.points[2] = clamp(c, vec2f(0.0), vec2f(1.0));
        shape.color = vec4f(pigment, 0.55 + random01(seed + 84u) * 0.4);
        shape.properties = vec4f(3.0, 0.0, 0.0, 0.0);
        return shape;
      }

      fn randomTriangle(seed: u32) -> Shape {
        var shape: Shape;
        for (var point = 0u; point < 3u; point += 1u) {
          shape.points[point] = vec2f(random01(seed + point * 2u + 1u), random01(seed + point * 2u + 2u));
        }
        shape.color = vec4f(random01(seed + 7u), random01(seed + 8u), random01(seed + 9u), 0.15 + random01(seed + 10u) * 0.65);
        shape.properties = vec4f(3.0, 0.0, 0.0, 0.0);
        return shape;
      }

      @compute @workgroup_size(64)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        let i = id.x;
        let candidateIndex = params.batchStart + id.y;
        if (i >= MAX_SHAPES || id.y >= params.batchCount) { return; }
        let bufferIndex = id.y * MAX_SHAPES + i;
        let seed = params.seed + candidateIndex * 0x85ebca6bu + i * 0x9e3779b9u;
        let currentCount = atomicLoad(&bestCount[0]);
        var candidateCount = params.count;
        let topologyChance = random01(params.seed + candidateIndex * 0x85ebca6bu + 0xa511e9b3u);
        let topologyRoll = random01(params.seed + candidateIndex * 0x85ebca6bu + 0x63d83595u);
        let topologyMutation = params.initial == 0u && topologyChance < params.structuralMutation;
        let targetShapeIndex = min(
          u32(random01(params.seed + candidateIndex * 0x85ebca6bu + 0x1b56c4e9u) * f32(currentCount)),
          currentCount - 1u
        );
        let targetVertexCount = u32(best[targetShapeIndex].properties.x);
        let addVertex = topologyMutation && topologyRoll >= 0.5 && topologyRoll < 0.75
          && targetVertexCount < min(params.maxVertices, MAX_VERTICES);
        let removeVertex = topologyMutation && topologyRoll >= 0.75 && targetVertexCount > 3u;
        let shapeChange = topologyMutation && !addVertex && !removeVertex;
        let shapeRoll = random01(params.seed + candidateIndex * 0x85ebca6bu + 0x392ab741u);
        let addShape = shapeChange && (shapeRoll < 0.5 || currentCount == 1u) && currentCount < MAX_SHAPES;
        let removeShape = shapeChange && !addShape && currentCount > 1u;
        candidateCount = currentCount;
        if (addShape) { candidateCount = min(currentCount + 1u, MAX_SHAPES); }
        if (removeShape) { candidateCount = currentCount - 1u; }
        if (i == 0u) { candidateCounts[candidateIndex] = candidateCount; }
        if (params.initial == 1u) {
          if (i >= params.count) { return; }
          candidate[bufferIndex] = randomTriangle(seed);
          return;
        }

        if (i >= candidateCount) { return; }
        let removedShapeIndex = min(
          u32(random01(params.seed + candidateIndex * 0x85ebca6bu + 0x63d83595u) * f32(currentCount)),
          currentCount - 1u
        );
        if (addShape && i == currentCount) {
          if (params.focusEnabled == 1u && random01(seed + 35u) < params.focusProbability) {
            let samplePosition = mix(params.focusMin, params.focusMax, vec2f(random01(seed + 36u), random01(seed + 37u)));
            let dims = textureDimensions(targetImage);
            let point = vec2u(
              min(u32(samplePosition.x * f32(dims.x)), dims.x - 1u),
              min(u32(samplePosition.y * f32(dims.y)), dims.y - 1u)
            );
            let center = (vec2f(point) + vec2f(0.5)) / vec2f(dims);
            let pigment = textureLoad(targetImage, vec2i(point), 0).rgb;
            candidate[bufferIndex] = sourceTriangle(center, pigment, seed, 0.008 + params.mutation * 0.045);
            return;
          }
          candidate[bufferIndex] = randomTriangle(seed);
          return;
        }
        var sourceIndex = i;
        if (removeShape && i >= removedShapeIndex) { sourceIndex += 1u; }
        var shape = best[sourceIndex];
        if (topologyMutation) {
          if (addVertex && sourceIndex == targetShapeIndex) {
            let pointCount = u32(shape.properties.x);
            let edgeIndex = min(u32(random01(seed + 28u) * f32(pointCount)), pointCount - 1u);
            let nextIndex = (edgeIndex + 1u) % pointCount;
            let amount = 0.25 + random01(seed + 29u) * 0.5;
            let newPoint = mix(shape.points[edgeIndex], shape.points[nextIndex], amount);
            for (var point = pointCount; point > edgeIndex + 1u; point -= 1u) {
              shape.points[point] = shape.points[point - 1u];
            }
            shape.points[edgeIndex + 1u] = clamp(newPoint, vec2f(0.0), vec2f(1.0));
            shape.properties.x = f32(pointCount + 1u);
          }
          if (removeVertex && sourceIndex == targetShapeIndex) {
            let pointCount = u32(shape.properties.x);
            let removedPoint = min(u32(random01(seed + 32u) * f32(pointCount)), pointCount - 1u);
            for (var point = removedPoint; point + 1u < pointCount; point += 1u) {
              shape.points[point] = shape.points[point + 1u];
            }
            shape.properties.x = f32(pointCount - 1u);
          }
          candidate[bufferIndex] = shape;
          return;
        }
        if (params.initial == 2u && candidateIndex == 0u) {
          candidate[bufferIndex] = shape;
          return;
        }
        let guidedIndex = candidateIndex % candidateCount;
        if (params.initial == 0u && params.guideReady == 1u && i == guidedIndex && random01(seed + 32u) < 0.35) {
          let focusThisMutation = params.focusEnabled == 1u && random01(seed + 34u) < params.focusProbability;
          let randomSourceSample = focusThisMutation && random01(seed + 35u) < 0.5;
          let dims = textureDimensions(targetImage);
          var hotspot = vec2u(0u);
          var hotspotError = -1.0;
          if (randomSourceSample) {
            let samplePosition = mix(params.focusMin, params.focusMax, vec2f(random01(seed + 36u), random01(seed + 37u)));
            hotspot = vec2u(
              min(u32(samplePosition.x * f32(dims.x)), dims.x - 1u),
              min(u32(samplePosition.y * f32(dims.y)), dims.y - 1u)
            );
          } else {
            for (var attempt = 0u; attempt < 16u; attempt += 1u) {
              let sampleSeed = seed + 40u + attempt * 2u;
              var samplePosition = vec2f(random01(sampleSeed), random01(sampleSeed + 1u));
              if (focusThisMutation) {
                samplePosition = mix(params.focusMin, params.focusMax, samplePosition);
              }
              let point = vec2u(
                min(u32(samplePosition.x * f32(dims.x)), dims.x - 1u),
                min(u32(samplePosition.y * f32(dims.y)), dims.y - 1u)
              );
              let error = errorMap[point.y * dims.x + point.x];
              if (error > hotspotError) {
                hotspot = point;
                hotspotError = error;
              }
            }
          }
          let center = (vec2f(hotspot) + vec2f(0.5)) / vec2f(dims);
          let pigment = textureLoad(targetImage, vec2i(hotspot), 0).rgb;
          candidate[bufferIndex] = sourceTriangle(center, pigment, seed, 0.008 + params.mutation * 0.045);
          return;
        }
        let chance = random01(seed + 11u);
        if (chance < 0.085) {
          let amount = params.mutation;
          let pointCount = u32(shape.properties.x);
          for (var point = 0u; point < pointCount; point += 1u) {
            shape.points[point].x = clamp(shape.points[point].x + signedRandom(seed + 12u + point * 2u) * amount * 0.16, 0.0, 1.0);
            shape.points[point].y = clamp(shape.points[point].y + signedRandom(seed + 13u + point * 2u) * amount * 0.16, 0.0, 1.0);
          }
        }
        if (random01(seed + 18u) < 0.12) {
          let amount = params.mutation * 0.22;
          shape.color.r = clamp(shape.color.r + signedRandom(seed + 19u) * amount, 0.0, 1.0);
          shape.color.g = clamp(shape.color.g + signedRandom(seed + 20u) * amount, 0.0, 1.0);
          shape.color.b = clamp(shape.color.b + signedRandom(seed + 21u) * amount, 0.0, 1.0);
        }
        if (random01(seed + 22u) < 0.1) {
          shape.color.a = clamp(shape.color.a + signedRandom(seed + 23u) * params.mutation * 0.25, 0.03, 0.9);
        }
        if (random01(seed + 24u) < 0.008) {
          let point = min(u32(random01(seed + 25u) * shape.properties.x), u32(shape.properties.x) - 1u);
          shape.points[point] = vec2f(random01(seed + 26u), random01(seed + 27u));
        }
        candidate[bufferIndex] = shape;
      }
    `;

export const evaluationShader = `
      struct Params { count: u32, atlasColumns: u32, seed: u32, initial: u32, mutation: f32, guideReady: u32, batchStart: u32, batchCount: u32, structuralMutation: f32, focusEnabled: u32, focusProbability: f32, maxVertices: u32, focusMin: vec2f, focusMax: vec2f };
      const REFERENCE_PIXELS: f32 = 25600.0;
      @group(0) @binding(0) var targetImage: texture_2d<f32>;
      @group(0) @binding(1) var candidateAtlas: texture_2d<f32>;
      @group(0) @binding(2) var<storage, read_write> score: array<atomic<u32>>;
      @group(0) @binding(3) var<uniform> params: Params;
      @group(0) @binding(4) var<storage, read> candidateCounts: array<u32>;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        let dims = textureDimensions(targetImage);
        if (id.x >= dims.x || id.y >= dims.y || id.z >= params.batchCount) { return; }
        let pixel = vec2u(id.xy);
        let candidateIndex = params.batchStart + id.z;
        let tile = vec2u(id.z % params.atlasColumns, id.z / params.atlasColumns) * dims;
        let atlasPixel = vec2i(tile + pixel);
        let fullDifference = textureLoad(candidateAtlas, atlasPixel, 0).rgb - textureLoad(targetImage, vec2i(pixel), 0).rgb;
        var weightedError = dot(fullDifference, fullDifference);

        if (pixel.x % 2u == 1u && pixel.y % 2u == 1u) {
          let samplePixel = min((pixel / 2u) * 2u + vec2u(1u), dims - vec2u(1u));
          let difference = textureLoad(candidateAtlas, vec2i(tile + samplePixel), 0).rgb - textureLoad(targetImage, vec2i(samplePixel), 0).rgb;
          weightedError += dot(difference, difference) * 4.0;
        }
        if (pixel.x % 4u == 2u && pixel.y % 4u == 2u) {
          let samplePixel = min((pixel / 4u) * 4u + vec2u(2u), dims - vec2u(1u));
          let difference = textureLoad(candidateAtlas, vec2i(tile + samplePixel), 0).rgb - textureLoad(targetImage, vec2i(samplePixel), 0).rgb;
          weightedError += dot(difference, difference) * 16.0;
        }
        if (pixel.x % 8u == 4u && pixel.y % 8u == 4u) {
          let samplePixel = min((pixel / 8u) * 8u + vec2u(4u), dims - vec2u(1u));
          let difference = textureLoad(candidateAtlas, vec2i(tile + samplePixel), 0).rgb - textureLoad(targetImage, vec2i(samplePixel), 0).rgb;
          weightedError += dot(difference, difference) * 64.0;
        }
        let resolutionScale = REFERENCE_PIXELS / f32(dims.x * dims.y);
        atomicAdd(&score[candidateIndex], u32(round(weightedError * 10000.0 * resolutionScale)));
      }
    `;

export const finalizeShader = `
      struct Shape { points: array<vec2f, 16>, color: vec4f, properties: vec4f };
      struct Params { count: u32, population: u32, seed: u32, initial: u32, mutation: f32, guideReady: u32, batchStart: u32, batchCount: u32, structuralMutation: f32, focusEnabled: u32, focusProbability: f32, maxVertices: u32, focusMin: vec2f, focusMax: vec2f };
      const MAX_SHAPES: u32 = 512u;
      @group(0) @binding(0) var<storage, read> candidate: array<Shape>;
      @group(0) @binding(1) var<storage, read_write> best: array<Shape>;
      @group(0) @binding(2) var<storage, read_write> score: array<atomic<u32>>;
      @group(0) @binding(3) var<storage, read_write> bestScore: array<atomic<u32>>;
      @group(0) @binding(4) var<uniform> params: Params;
      @group(0) @binding(5) var<storage, read> candidateCounts: array<u32>;
      @group(0) @binding(6) var<storage, read_write> bestCount: array<atomic<u32>>;
      @compute @workgroup_size(1)
      fn main() {
        var scoreToBeat = atomicLoad(&bestScore[0]);
        for (var localIndex = 0u; localIndex < params.batchCount; localIndex += 1u) {
          let candidateIndex = params.batchStart + localIndex;
          let candidateScore = atomicLoad(&score[candidateIndex]);
          if (candidateScore < scoreToBeat) {
            let count = candidateCounts[candidateIndex];
            for (var i = 0u; i < count; i += 1u) {
              best[i] = candidate[localIndex * MAX_SHAPES + i];
            }
            scoreToBeat = candidateScore;
            atomicStore(&bestScore[0], candidateScore);
            atomicStore(&bestCount[0], count);
          }
        }
      }
    `;

export const rasterShader = `
      struct Shape { points: array<vec2f, 16>, color: vec4f, properties: vec4f };
      struct Params { count: u32, population: u32, seed: u32, initial: u32, mutation: f32, guideReady: u32, batchStart: u32, batchCount: u32, structuralMutation: f32, focusEnabled: u32, focusProbability: f32, maxVertices: u32, focusMin: vec2f, focusMax: vec2f };
      const MAX_SHAPES: u32 = 512u;
      const FAN_TRIANGLES: u32 = 14u;
      @group(0) @binding(0) var<storage, read> candidate: array<Shape>;
      @group(0) @binding(1) var<storage, read> candidateCounts: array<u32>;
      @group(0) @binding(2) var<uniform> params: Params;

      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) color: vec3f,
        @location(1) opacity: f32
      };

      @vertex
      fn vertexMain(
        @builtin(vertex_index) vertexIndex: u32,
        @builtin(instance_index) localCandidate: u32
      ) -> VertexOutput {
        var output: VertexOutput;
        output.color = vec3f(1.0);
        output.opacity = 0.0;
        let candidateIndex = params.batchStart + localCandidate;
        let triangleIndex = vertexIndex / 3u;
        let shapeIndex = triangleIndex / FAN_TRIANGLES;
        let fanIndex = triangleIndex % FAN_TRIANGLES;
        if (shapeIndex >= candidateCounts[candidateIndex]) {
          output.position = vec4f(2.0, 2.0, 0.0, 1.0);
          return output;
        }
        let shape = candidate[localCandidate * MAX_SHAPES + shapeIndex];
        if (fanIndex + 2u >= u32(shape.properties.x)) {
          output.position = vec4f(2.0, 2.0, 0.0, 1.0);
          return output;
        }
        var point = shape.points[0];
        if (vertexIndex % 3u == 1u) { point = shape.points[fanIndex + 1u]; }
        if (vertexIndex % 3u == 2u) { point = shape.points[fanIndex + 2u]; }
        output.position = vec4f(point.x * 2.0 - 1.0, 1.0 - point.y * 2.0, 0.0, 1.0);
        output.color = shape.color.rgb;
        output.opacity = shape.color.a;
        return output;
      }

      @fragment
      fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
        return vec4f(input.color, input.opacity);
      }
    `;

export const guideShader = `
      @group(0) @binding(0) var targetImage: texture_2d<f32>;
      @group(0) @binding(1) var bestImage: texture_2d<f32>;
      @group(0) @binding(2) var<storage, read_write> errorMap: array<f32>;

      @compute @workgroup_size(8, 8)
      fn main(@builtin(global_invocation_id) id: vec3u) {
        let dims = textureDimensions(targetImage);
        if (id.x >= dims.x || id.y >= dims.y) { return; }
        let pixel = vec2i(id.xy);
        let difference = textureLoad(targetImage, pixel, 0).rgb - textureLoad(bestImage, pixel, 0).rgb;
        errorMap[id.y * dims.x + id.x] = dot(difference, difference);
      }
    `;

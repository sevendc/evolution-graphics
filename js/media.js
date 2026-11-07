export function drawSourceCover(source, context, size) {
  context.clearRect(0, 0, size, size);
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.max(size / width, size / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.drawImage(source, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);
}

export function makeSampleArtwork(context, size) {
  context.save();
  context.scale(size / 160, size / 160);
  const gradient = context.createLinearGradient(0, 0, 160, 160);
  gradient.addColorStop(0, "#b8c5a1");
  gradient.addColorStop(.52, "#637b68");
  gradient.addColorStop(1, "#253e46");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#e7bb78";
  context.beginPath();
  context.arc(119, 43, 21, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#405c54";
  context.beginPath();
  context.moveTo(0, 112);
  context.lineTo(39, 61);
  context.lineTo(73, 110);
  context.lineTo(112, 55);
  context.lineTo(160, 113);
  context.lineTo(160, 160);
  context.lineTo(0, 160);
  context.closePath();
  context.fill();
  context.fillStyle = "#29434a";
  context.beginPath();
  context.moveTo(0, 127);
  context.lineTo(55, 91);
  context.lineTo(95, 133);
  context.lineTo(135, 92);
  context.lineTo(160, 113);
  context.lineTo(160, 160);
  context.lineTo(0, 160);
  context.closePath();
  context.fill();
  context.fillStyle = "#d5a676";
  context.beginPath();
  context.moveTo(0, 139);
  context.quadraticCurveTo(48, 122, 91, 145);
  context.quadraticCurveTo(126, 163, 160, 137);
  context.lineTo(160, 160);
  context.lineTo(0, 160);
  context.fill();
  context.restore();
}

export async function loadImageFile(file, { context, size, setImageName, setImageSource, stopCamera, targetReady, setNotice, reportError }) {
  if (!file || !file.type.startsWith("image/")) {
    setNotice("Choose a supported image file.", true);
    return;
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    drawSourceCover(bitmap, context, size);
    setImageSource(bitmap);
    bitmap = null;
    setImageName(file.name.replace(/\.[^.]+$/, "") || "image");
    stopCamera();
    await targetReady();
  } catch (error) {
    reportError(error);
  } finally {
    bitmap?.close();
  }
}

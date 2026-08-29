export function countDirectionalPixelChanges(sourcePixels, targetPixels, width, height, channelTolerance, neighborhoodRadius = 1) {
  const pixelDelta = (sourceIndex, targetIndex) => Math.max(
    Math.abs(sourcePixels[sourceIndex] - targetPixels[targetIndex]),
    Math.abs(sourcePixels[sourceIndex + 1] - targetPixels[targetIndex + 1]),
    Math.abs(sourcePixels[sourceIndex + 2] - targetPixels[targetIndex + 2]),
    Math.abs(sourcePixels[sourceIndex + 3] - targetPixels[targetIndex + 3])
  );

  let changed = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceIndex = (y * width + x) * 4;
      if (pixelDelta(sourceIndex, sourceIndex) <= channelTolerance) continue;

      let neighborhoodMatch = false;
      for (let targetY = Math.max(0, y - neighborhoodRadius); targetY <= Math.min(height - 1, y + neighborhoodRadius) && !neighborhoodMatch; targetY += 1) {
        for (let targetX = Math.max(0, x - neighborhoodRadius); targetX <= Math.min(width - 1, x + neighborhoodRadius); targetX += 1) {
          const targetIndex = (targetY * width + targetX) * 4;
          if (pixelDelta(sourceIndex, targetIndex) <= channelTolerance) {
            neighborhoodMatch = true;
            break;
          }
        }
      }
      if (!neighborhoodMatch) changed += 1;
    }
  }
  return changed;
}

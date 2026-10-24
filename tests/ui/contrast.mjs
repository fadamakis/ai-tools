// Measure rendered sRGB contrast, compositing translucent surfaces from the root.
export async function contrastRatio(locator, pseudo = null) {
  return locator.evaluate((element, pseudo) => {
    const parse = color => {
      const values = color.match(/[\d.]+/g).map(Number);
      return [...values.slice(0, 3), values[3] ?? 1];
    };
    const over = (front, back) => front.slice(0, 3).map((value, i) => value * front[3] + back[i] * (1 - front[3]));
    const ancestors = [];
    for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    const background = ancestors.reduce((back, node) => over(parse(getComputedStyle(node).backgroundColor), back), [255, 255, 255]);
    const foreground = over(parse(getComputedStyle(element, pseudo).color), background);
    const luminance = color => color.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }, pseudo);
}

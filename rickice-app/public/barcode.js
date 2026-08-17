/* UPC-A check digit + scannable SVG render. No dependencies, no CDN. */
(function (global) {
  const L_CODE = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const R_CODE = L_CODE.map(bits => bits.split('').map(b => b === '1' ? '0' : '1').join(''));
  const GUARD_SIDE = '101';
  const GUARD_MID = '01010';

  function checkDigit(digits11) {
    let odd = 0, even = 0;
    for (let i = 0; i < 11; i++) (i % 2 === 0 ? odd += Number(digits11[i]) : even += Number(digits11[i]));
    return String((10 - ((odd * 3 + even) % 10)) % 10);
  }

  function isValid(digits12) {
    return /^\d{12}$/.test(digits12) && checkDigit(digits12.slice(0, 11)) === digits12[11];
  }

  function pattern(digits12) {
    const left = digits12.slice(0, 6).split('').map(d => L_CODE[+d]).join('');
    const right = digits12.slice(6, 12).split('').map(d => R_CODE[+d]).join('');
    return GUARD_SIDE + left + GUARD_MID + right + GUARD_SIDE;
  }

  function renderSVG(digits12, opts) {
    opts = opts || {};
    if (!/^\d{12}$/.test(digits12)) return '';
    const moduleW = opts.moduleWidth || 2.2;
    const barH = opts.height || 70;
    const quiet = opts.quietModules == null ? 10 : opts.quietModules;
    const bits = pattern(digits12);
    const width = (bits.length + quiet * 2) * moduleW;
    const labelH = opts.showText === false ? 0 : 18;
    const svgH = barH + labelH;
    let bars = '';
    let x = quiet * moduleW;
    for (let i = 0; i < bits.length; i++) {
      if (bits[i] === '1') bars += `<rect x="${x.toFixed(2)}" y="0" width="${moduleW.toFixed(2)}" height="${barH}" fill="#000"/>`;
      x += moduleW;
    }
    const text = opts.showText === false ? '' :
      `<text x="${(width / 2).toFixed(2)}" y="${barH + 14}" font-family="Helvetica,Arial,sans-serif" font-size="13" text-anchor="middle" letter-spacing="2">${digits12}</text>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(2)} ${svgH}" width="${width.toFixed(0)}" height="${svgH}">
<rect x="0" y="0" width="${width.toFixed(2)}" height="${svgH}" fill="#fff"/>
${bars}${text}
</svg>`;
  }

  global.UPC = { checkDigit, isValid, renderSVG };
})(window);

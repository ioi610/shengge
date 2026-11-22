export type PrintedBox = {left:number;top:number;width:number;height:number};

/** Blank scanlines can split one outlined character row into two cropped
 * boxes. Only reunite fragments in the separate band above the original. */
export function printedReferenceLine(rows:PrintedBox[], lineHeight:number, width:number, height:number) {
  const [bottom, top] = rows;
  if (!bottom) return;
  const usable = (row:PrintedBox) => row.height >= lineHeight * 0.65 &&
    height - row.top - row.height <= lineHeight * 0.5;
  if (usable(bottom)) return bottom;
  if (!top || top.top >= bottom.top || top.height >= lineHeight * 0.85 ||
      top.top + top.height < bottom.top - 1) return;
  const overlap = Math.min(top.left + top.width, bottom.left + bottom.width) - Math.max(top.left,bottom.left);
  if (overlap < Math.max(top.width,bottom.width) * 0.72) return;
  const left = Math.max(0,Math.min(top.left,bottom.left)-5);
  const rowTop = Math.max(0,top.top-2);
  const combined = {left, top:rowTop,
    width: Math.min(width,Math.max(top.left+top.width,bottom.left+bottom.width)+5)-left,
    height: Math.min(height,bottom.top+bottom.height+2)-rowTop};
  if (combined.height <= lineHeight*1.5 && usable(combined)) return combined;
}

export interface PaneGeometry {
  collapsed: boolean;
  width: number;
  opacity: number;
}

/** 计算侧栏拖拽过程中的折叠状态、宽度与透明度 */
export function paneDrag(
  raw: number,
  minimum: number,
  maximum: number,
): PaneGeometry {
  const min = Math.min(minimum, maximum);
  const width = Math.max(0, Math.min(maximum, raw));
  return {
    collapsed: width <= min / 2,
    width: width <= min / 2 ? 0 : width,
    opacity: min ? Math.max(0, Math.min(1, (width - min / 2) / (min / 2))) : 0,
  };
}

/** 计算拖拽释放后的最终面板吸附宽度 */
export function paneRelease(
  raw: number,
  minimum: number,
  maximum: number,
): PaneGeometry {
  const state = paneDrag(raw, minimum, maximum);
  return {
    ...state,
    width: state.collapsed
      ? 0
      : Math.max(Math.min(minimum, maximum), state.width),
    opacity: state.collapsed ? 0 : 1,
  };
}

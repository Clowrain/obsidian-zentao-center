export interface FilterPopoverPointerState {
  isOpen: boolean;
  isInsideFilterControls: boolean;
}

export function shouldCloseFilterPopoverOnPointerDown(state: FilterPopoverPointerState): boolean {
  return state.isOpen && !state.isInsideFilterControls;
}

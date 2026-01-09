
export interface PsdLayer {
  id: string;
  name: string;
  type: 'layer' | 'group';
  visible: boolean;
  opacity: number;
  // Canvas is removed from here to prevent React from tracking huge objects
  children?: PsdLayer[];
  isSelected: boolean;
  width: number;
  height: number;
  top: number;
  left: number;
}

export interface ProcessingState {
  status: 'idle' | 'parsing' | 'trimming' | 'ready' | 'exporting';
  progress: number;
  message: string;
}

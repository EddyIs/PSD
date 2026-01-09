
import React, { useState } from 'react';
import { ChevronRight, ChevronDown, Folder, Image as ImageIcon, Eye, EyeOff, CheckSquare, Square } from 'lucide-react';
import { PsdLayer } from '../types';

interface LayerTreeProps {
  layers: PsdLayer[];
  onToggleSelect: (id: string) => void;
  onPreview: (layer: PsdLayer) => void;
  level?: number;
}

const LayerItem: React.FC<{
  layer: PsdLayer;
  level: number;
  onToggleSelect: (id: string) => void;
  onPreview: (layer: PsdLayer) => void;
}> = ({ layer, level, onToggleSelect, onPreview }) => {
  const [isOpen, setIsOpen] = useState(true);
  const isGroup = layer.type === 'group';

  return (
    <div className="select-none">
      <div 
        className={`flex items-center gap-2 py-1.5 px-2 hover:bg-white/5 cursor-pointer rounded-md transition-colors group ${layer.isSelected ? 'bg-indigo-500/10' : ''}`}
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => isGroup ? setIsOpen(!isOpen) : onPreview(layer)}
      >
        <div 
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(layer.id);
          }}
          className="text-zinc-500 hover:text-indigo-400 p-0.5"
        >
          {layer.isSelected ? <CheckSquare size={16} className="text-indigo-500" /> : <Square size={16} />}
        </div>
        
        {isGroup ? (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Folder size={14} className="text-amber-400 shrink-0" />
            <span className="truncate text-sm font-medium">{layer.name || 'Untitled Group'}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <div className="w-[14px]" />
            <ImageIcon size={14} className="text-sky-400 shrink-0" />
            <span className="truncate text-sm">{layer.name || 'Layer'}</span>
          </div>
        )}

        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-2">
           {layer.visible ? <Eye size={12} className="text-zinc-500" /> : <EyeOff size={12} className="text-zinc-500" />}
        </div>
      </div>

      {isGroup && isOpen && layer.children && (
        <div className="mt-0.5">
          {layer.children.map(child => (
            <LayerItem 
              key={child.id} 
              layer={child} 
              level={level + 1} 
              onToggleSelect={onToggleSelect} 
              onPreview={onPreview} 
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const LayerTree: React.FC<LayerTreeProps> = ({ layers, onToggleSelect, onPreview, level = 0 }) => {
  return (
    <div className="flex flex-col gap-0.5">
      {layers.map(layer => (
        <LayerItem 
          key={layer.id} 
          layer={layer} 
          level={level} 
          onToggleSelect={onToggleSelect} 
          onPreview={onPreview} 
        />
      ))}
    </div>
  );
};

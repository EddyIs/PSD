
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, Download, Zap, FileCode, AlertCircle, 
  Monitor, Terminal, Cpu, Copy, Check, 
  FolderTree, Loader2, Package, Rocket, Settings,
  ArrowRight, ShieldCheck, Box, Layers, MousePointer2, Info,
  PlusSquare, MoreVertical, X, ExternalLink, Shield, HardDrive,
  BarChart3, FileJson
} from 'lucide-react';
import { trimCanvas } from './services/psdProcessor';
import { PsdLayer, ProcessingState } from './types';
import { LayerTree } from './components/LayerTree';
import { readPsd } from 'ag-psd';
import JSZip from 'jszip';

type NamingStyle = 'original' | 'snake_case' | 'kebab-case' | 'PascalCase';

const App: React.FC = () => {
  const psdRef = useRef<any>(null);
  const layerMapRef = useRef<Map<string, any>>(new Map());
  const [layers, setLayers] = useState<PsdLayer[]>([]);
  const [previewLayer, setPreviewLayer] = useState<{id: string, name: string, canvas: HTMLCanvasElement, w: number, h: number} | null>(null);
  
  const [state, setState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    message: '本地引擎就绪'
  });
  
  const [stats, setStats] = useState({ total: 0, selected: 0, groups: 0 });
  const [namingStyle, setNamingStyle] = useState<NamingStyle>('snake_case');
  const [useFolderPrefix, setUseFolderPrefix] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 统计逻辑
  useEffect(() => {
    let total = 0, selected = 0, groups = 0;
    const count = (list: PsdLayer[]) => {
      list.forEach(l => {
        if (l.type === 'group') groups++;
        else total++;
        if (l.isSelected && l.type === 'layer') selected++;
        if (l.children) count(l.children);
      });
    };
    count(layers);
    setStats({ total, selected, groups });
  }, [layers]);

  const transformName = (name: string, style: NamingStyle) => {
    let base = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (style === 'snake_case') return base.toLowerCase().replace(/\s+/g, '_');
    if (style === 'kebab-case') return base.toLowerCase().replace(/\s+/g, '-');
    if (style === 'PascalCase') return base.replace(/(\w)(\w*)/g, (g, g1, g2) => g1.toUpperCase() + g2.toLowerCase()).replace(/\s+/g, '');
    return base;
  };

  const loadPsd = async (file: File) => {
    reset();
    setState({ status: 'parsing', progress: 5, message: `正在准备读取: ${file.name}` });

    // 确保 UI 渲染出加载状态
    await new Promise(r => setTimeout(r, 150));

    try {
      setState({ status: 'parsing', progress: 20, message: '读取本地文件流...' });
      const buffer = await file.arrayBuffer();
      
      setState({ status: 'parsing', progress: 45, message: '解析 PSD 结构 (大型文件可能需要几秒)...' });
      await new Promise(r => setTimeout(r, 100));

      const psd = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          try {
            const data = readPsd(buffer, { skipThumbnail: true });
            resolve(data);
          } catch (e) {
            reject(e);
          }
        }, 50);
      });

      psdRef.current = psd;
      setState({ status: 'parsing', progress: 80, message: '构建可视化图层树...' });

      const transformLayers = (psdLayers: any[]): PsdLayer[] => {
        return psdLayers.map((l) => {
          const id = `layer-${Math.random().toString(36).substr(2, 9)}`;
          layerMapRef.current.set(id, l);
          return {
            id,
            name: l.name || '未命名',
            type: l.children ? 'group' : 'layer',
            visible: l.visible !== false,
            opacity: l.opacity ?? 1,
            isSelected: l.visible !== false && !l.children,
            width: l.width ?? 0,
            height: l.height ?? 0,
            top: l.top ?? 0,
            left: l.left ?? 0,
            children: l.children ? transformLayers(l.children) : undefined
          };
        });
      };

      const root = transformLayers(psd.children || []);
      setLayers(root);
      
      setState({ status: 'parsing', progress: 100, message: '加载成功' });
      await new Promise(r => setTimeout(r, 400));
      setState({ status: 'ready', progress: 100, message: '本地引擎已就绪' });
    } catch (err: any) {
      console.error("[LoaderError]", err);
      setState({ status: 'idle', progress: 0, message: "解析失败: 可能是内存不足或文件格式不支持" });
      alert("解析 PSD 失败，请确保文件未损坏且内存充足。");
    }
  };

  const exportAssets = async () => {
    if (layers.length === 0) return;
    setState({ status: 'exporting', progress: 0, message: '初始化导出工作区...' });
    
    try {
      const zip = new JSZip();
      let totalLayers = stats.selected;
      let processedCount = 0;

      if (totalLayers === 0) {
        alert("请在左侧勾选需要导出的图层");
        setState({ status: 'ready', progress: 100, message: '未选中导出项' });
        return;
      }

      const processLevel = async (list: PsdLayer[], currentZip: JSZip, prefixPath: string = "") => {
        for (const l of list) {
          const cleanName = transformName(l.name, namingStyle);
          if (l.type === 'group') {
            const folder = currentZip.folder(cleanName);
            if (l.children && folder) {
              await processLevel(l.children, folder, useFolderPrefix ? `${prefixPath}${cleanName}_` : "");
            }
          } else if (l.type === 'layer' && l.isSelected) {
            const raw = layerMapRef.current.get(l.id);
            if (raw) {
              processedCount++;
              setState({ 
                status: 'exporting', 
                progress: (processedCount / totalLayers) * 100, 
                message: `正在切图: ${l.name} (${processedCount}/${totalLayers})` 
              });
              const trimmed = trimCanvas(raw);
              if (trimmed) {
                const blob = await new Promise<Blob | null>(res => trimmed.canvas.toBlob(res, 'image/png'));
                if (blob) zip.file(`${prefixPath}${cleanName}.png`, blob);
              }
              if (processedCount % 5 === 0) await new Promise(r => setTimeout(r, 10));
            }
          }
        }
      };

      await processLevel(layers, zip);
      setState({ status: 'exporting', progress: 99, message: '打包 ZIP 中...' });
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `Slices_${Date.now()}.zip`;
      link.click();
      setState({ status: 'ready', progress: 100, message: '导出完成' });
    } catch (e) {
      console.error("[ExportError]", e);
      setState({ status: 'ready', progress: 100, message: '导出中断' });
    }
  };

  const handlePreview = useCallback((layer: PsdLayer) => {
    const raw = layerMapRef.current.get(layer.id);
    if (!raw) return;
    const trimmed = trimCanvas(raw);
    if (trimmed) {
      setPreviewLayer({ id: layer.id, name: layer.name, canvas: trimmed.canvas, w: trimmed.width, h: trimmed.height });
    }
  }, []);

  const toggleSelect = useCallback((id: string) => {
    const update = (list: PsdLayer[]): PsdLayer[] => {
      return list.map(l => {
        if (l.id === id) {
          const n = !l.isSelected;
          const u = (c?: PsdLayer[]): PsdLayer[] | undefined => c?.map(x => ({ ...x, isSelected: n, children: u(x.children) }));
          return { ...l, isSelected: n, children: u(l.children) };
        }
        if (l.children) return { ...l, children: update(l.children) };
        return l;
      });
    };
    setLayers(prev => update(prev));
  }, []);

  const reset = () => {
    psdRef.current = null;
    layerMapRef.current.clear();
    setLayers([]);
    setPreviewLayer(null);
    setState({ status: 'idle', progress: 0, message: '本地引擎就绪' });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#030303] text-zinc-100 font-sans">
      
      {/* 全屏加载状态遮罩 */}
      {(state.status === 'parsing' || state.status === 'exporting') && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[2000] flex flex-col items-center justify-center p-12 text-center animate-in fade-in duration-500">
           <div className="relative mb-10">
              <div className="w-24 h-24 border-[4px] border-white/5 border-t-indigo-500 rounded-full animate-spin shadow-2xl shadow-indigo-600/20" />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-black tabular-nums tracking-tighter text-indigo-400">
                {Math.round(state.progress)}%
              </div>
           </div>
           <div className="space-y-4 max-w-sm">
             <h3 className="text-2xl font-black italic uppercase tracking-tighter text-white">
               {state.status === 'parsing' ? '解析 PSD 中' : '正在切图导出'}
             </h3>
             <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.4em] leading-relaxed">
               {state.message}
             </p>
           </div>
           <div className="mt-16 w-full max-w-[240px] h-1 bg-white/5 rounded-full overflow-hidden">
             <div 
               className="h-full bg-indigo-500 transition-all duration-500 ease-out" 
               style={{ width: `${state.progress}%` }} 
             />
           </div>
        </div>
      )}

      <header className="h-20 border-b border-white/5 bg-[#080808]/80 backdrop-blur-xl flex items-center justify-between px-10 shrink-0 z-[120]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <Zap size={20} fill="currentColor" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter italic uppercase leading-none">SliceMaster <span className="text-indigo-500">Pro</span></h1>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mt-1.5 flex items-center gap-2">
              <span className="w-1 h-1 bg-emerald-500 rounded-full" /> 100% 本地隐私安全模式
            </p>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {layers.length > 0 && (
            <button 
              onClick={exportAssets} 
              disabled={state.status === 'exporting'} 
              className="bg-white text-black px-8 py-2.5 rounded-xl font-black text-[10px] flex items-center gap-2 hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest shadow-lg"
            >
               <Download size={14} /> 批量导出 PNG
            </button>
          )}
          <div className="px-4 py-2 border border-white/5 bg-white/5 rounded-lg flex items-center gap-2">
             <ShieldCheck size={14} className="text-emerald-500" />
             <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500">本地处理无上传</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {layers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_50%,#0c0c0c,transparent)]">
            <div 
              onClick={() => fileInputRef.current?.click()} 
              className="group w-full max-w-xl aspect-[1.6] border-2 border-dashed border-zinc-900 hover:border-indigo-500/30 bg-[#070707] rounded-[60px] flex flex-col items-center justify-center gap-8 cursor-pointer transition-all duration-500 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-[0.02] transition-opacity" />
              <div className="w-20 h-20 bg-zinc-900 group-hover:bg-indigo-600 rounded-3xl flex items-center justify-center transition-all group-hover:-rotate-6 shadow-xl">
                <Upload className="text-zinc-600 group-hover:text-white" size={28} />
              </div>
              <div className="text-center relative">
                <h2 className="text-2xl font-black italic uppercase tracking-tighter">拖入本地 PSD</h2>
                <p className="text-zinc-700 text-[10px] mt-2 uppercase tracking-[0.4em] font-black">自动裁剪透明边距 • 保持分组目录</p>
              </div>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadPsd(e.target.files[0])} className="hidden" accept=".psd" />
            </div>
          </div>
        ) : (
          <>
            <aside className="w-80 border-r border-white/5 bg-[#050505] flex flex-col shrink-0">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">图层结构浏览</span>
                <span className="text-[8px] font-mono bg-zinc-900 text-zinc-500 px-2 py-1 rounded-md uppercase">{stats.groups} 容器</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-custom">
                <LayerTree layers={layers} onToggleSelect={toggleSelect} onPreview={handlePreview} />
              </div>
            </aside>

            <section className="flex-1 relative bg-[#010101] flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center p-12 checkerboard-pro">
                {previewLayer ? (
                  <div className="relative animate-in zoom-in duration-500 max-w-full max-h-full p-10">
                    <div className="absolute inset-0 bg-indigo-500/5 blur-[80px] rounded-full pointer-events-none" />
                    <div className="bg-[#0d0d0d] border border-white/10 rounded-[40px] overflow-hidden shadow-2xl flex flex-col relative z-10">
                      <div className="px-6 py-4 bg-white/5 flex justify-between items-center border-b border-white/5 text-[9px] font-black uppercase tracking-[0.2em]">
                        <span className="text-zinc-400 truncate max-w-[200px]">{previewLayer.name}</span>
                        <span className="text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded">{previewLayer.w} × {previewLayer.h} PX</span>
                      </div>
                      <div className="p-16 max-w-[50vw] max-h-[50vh] overflow-auto flex items-center justify-center scrollbar-custom">
                        <img src={previewLayer.canvas.toDataURL()} className="max-w-full h-auto drop-shadow-2xl" alt="Preview" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center opacity-[0.03] flex flex-col items-center gap-6">
                    <Layers size={120} />
                    <span className="text-sm font-black uppercase tracking-[0.8em]">PREVIEW MODE</span>
                  </div>
                )}
              </div>
              
              <div className="h-12 border-t border-white/5 bg-[#0a0a0a]/90 px-8 flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-4">
                   <div className={`w-2 h-2 rounded-full ${state.status === 'idle' ? 'bg-zinc-800' : 'bg-emerald-500 animate-pulse'}`} />
                   <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">{state.message}</span>
                 </div>
              </div>
            </section>

            <aside className="w-80 border-l border-white/5 bg-[#050505] shrink-0 flex flex-col p-8 space-y-12">
               <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <Settings size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">导出预设</h3>
                  </div>
                  
                  <div className="space-y-6 bg-white/2 p-6 rounded-3xl border border-white/5">
                    <div className="space-y-3">
                       <label className="text-[9px] font-black text-zinc-600 uppercase">命名规范</label>
                       <select 
                        value={namingStyle} 
                        onChange={(e) => setNamingStyle(e.target.value as NamingStyle)} 
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] font-black outline-none focus:border-indigo-500/50 transition-all cursor-pointer"
                       >
                         <option value="original">原始 (Original)</option>
                         <option value="snake_case">蛇形 (snake_case)</option>
                         <option value="kebab-case">短横 (kebab-case)</option>
                         <option value="PascalCase">驼峰 (PascalCase)</option>
                       </select>
                    </div>

                    <div className="flex items-center justify-between">
                       <div className="space-y-0.5">
                         <label className="text-[9px] font-black text-zinc-600 uppercase">保留目录结构</label>
                         <p className="text-[7px] text-zinc-800 font-black uppercase">自动生成文件夹层级</p>
                       </div>
                       <button 
                        onClick={() => setUseFolderPrefix(!useFolderPrefix)} 
                        className={`w-11 h-6 rounded-full relative transition-all duration-300 ${useFolderPrefix ? 'bg-indigo-600' : 'bg-zinc-800'}`}
                       >
                         <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-300 ${useFolderPrefix ? 'left-6' : 'left-1'}`} />
                       </button>
                    </div>
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <BarChart3 size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">图层统计</h3>
                  </div>
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-3xl p-6 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                           <span className="text-[8px] font-black uppercase text-zinc-600 block">图层总数</span>
                           <span className="text-white text-lg font-black tabular-nums">{stats.total}</span>
                        </div>
                        <div className="space-y-1">
                           <span className="text-[8px] font-black uppercase text-zinc-600 block">待导出项</span>
                           <span className="text-emerald-400 text-lg font-black tabular-nums">{stats.selected}</span>
                        </div>
                     </div>
                     <div className="pt-4 border-t border-emerald-500/10">
                        <p className="text-[8px] text-emerald-800/80 font-bold leading-relaxed uppercase">
                          已智能启用透明像素裁剪。导出的 PNG 资源将去除所有四周透明冗余。
                        </p>
                     </div>
                  </div>
               </div>

               <div className="flex-1" />
               
               <button 
                onClick={reset} 
                className="w-full py-4 rounded-2xl border border-white/5 hover:bg-red-500/5 hover:border-red-500/20 hover:text-red-500 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 transition-all duration-300 flex items-center justify-center gap-2"
               >
                  <X size={14} /> 释放当前 PSD
               </button>
            </aside>
          </>
        )}
      </main>

      <style>{`
        .checkerboard-pro { 
          background-image: linear-gradient(45deg, #050505 25%, transparent 25%), 
            linear-gradient(-45deg, #050505 25%, transparent 25%), 
            linear-gradient(45deg, transparent 75%, #050505 75%), 
            linear-gradient(-45deg, transparent 75%, #050505 75%); 
          background-size: 24px 24px; 
          background-position: 0 0, 0 12px, 12px -12px, -12px 0px; 
          background-color: #010101; 
        }
        .scrollbar-custom::-webkit-scrollbar { width: 5px; height: 5px; }
        .scrollbar-custom::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-custom::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  );
};

export default App;

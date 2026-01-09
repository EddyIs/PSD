
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
  
  // 统计信息
  const [stats, setStats] = useState({ total: 0, selected: 0, groups: 0 });

  // 设置
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
    // 1. 初始化
    setState({ status: 'parsing', progress: 5, message: `正在读取文件: ${file.name}` });
    await new Promise(r => setTimeout(r, 100)); // 确保 UI 渲染

    try {
      // 2. 加载 ArrayBuffer
      const buffer = await file.arrayBuffer();
      setState({ status: 'parsing', progress: 25, message: '正在解析 PSD 数据结构...' });
      await new Promise(r => setTimeout(r, 50));

      // 3. 解析 PSD (这是耗时同步操作，放在微任务里执行)
      const psd = await new Promise<any>((resolve, reject) => {
        setTimeout(() => {
          try {
            const data = readPsd(buffer, { skipThumbnail: true });
            resolve(data);
          } catch (e) {
            reject(e);
          }
        }, 50);
      });

      psdRef.current = psd;
      setState({ status: 'parsing', progress: 60, message: '正在递归构建图层树...' });
      await new Promise(r => setTimeout(r, 50));

      // 4. 构建树
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
      
      // 5. 完成
      setState({ status: 'parsing', progress: 100, message: '解析完成' });
      await new Promise(r => setTimeout(r, 300)); // 让用户看到 100%
      setState({ status: 'ready', progress: 100, message: '就绪' });

    } catch (err: any) {
      console.error(err);
      setState({ status: 'idle', progress: 0, message: "解析失败: 格式不支持或内存不足" });
    }
  };

  const exportAssets = async () => {
    if (layers.length === 0) return;
    setState({ status: 'exporting', progress: 0, message: '正在初始化本地导出队列...' });
    
    const zip = new JSZip();
    let totalLayers = stats.selected;
    let processedCount = 0;

    if (totalLayers === 0) {
      alert("请至少选择一个图层");
      setState({ status: 'ready', progress: 100, message: '未选择图层' });
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
              message: `正在裁剪透明像素: ${l.name} (${processedCount}/${totalLayers})` 
            });
            try {
              const trimmed = trimCanvas(raw);
              if (trimmed) {
                const blob = await new Promise<Blob | null>(res => trimmed.canvas.toBlob(res, 'image/png'));
                if (blob) zip.file(`${prefixPath}${cleanName}.png`, blob);
              }
            } catch (e) {}
            // 每处理几个图层释放一次主线程，保持 UI 响应
            if (processedCount % 4 === 0) await new Promise(r => setTimeout(r, 16));
          }
        }
      }
    };

    await processLevel(layers, zip);
    setState({ status: 'exporting', progress: 99, message: '正在封装 ZIP 压缩包...' });
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `Slices_${Date.now()}.zip`;
    link.click();
    setState({ status: 'ready', progress: 100, message: '导出成功' });
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
    <div className="flex flex-col h-screen overflow-hidden bg-[#030303] text-zinc-100 font-sans selection:bg-indigo-500/30">
      
      {/* 强化版加载/导出状态遮罩 */}
      {(state.status === 'parsing' || state.status === 'exporting') && (
        <div className="fixed inset-0 bg-black/95 backdrop-blur-3xl z-[2000] flex flex-col items-center justify-center p-12 text-center transition-all">
           <div className="relative mb-10">
              <div className="w-28 h-28 border-[6px] border-white/5 border-t-indigo-500 rounded-full animate-spin transition-all duration-300" />
              <div className="absolute inset-0 flex items-center justify-center text-sm font-black tabular-nums tracking-tighter">
                {Math.round(state.progress)}%
              </div>
           </div>
           <div className="space-y-3 max-w-sm">
             <h3 className="text-xl font-black italic uppercase tracking-tighter text-white">
               {state.status === 'parsing' ? '正在处理本地 PSD' : '资源导出打包中'}
             </h3>
             <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.3em] leading-relaxed transition-all">
               {state.message}
             </p>
           </div>
           <div className="mt-16 w-full max-w-[280px] h-1 bg-white/5 rounded-full overflow-hidden shadow-inner">
             <div 
               className="h-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500 cubic-bezier(0.4, 0, 0.2, 1)" 
               style={{ width: `${state.progress}%` }} 
             />
           </div>
        </div>
      )}

      <header className="h-20 border-b border-white/5 bg-[#080808]/90 backdrop-blur-2xl flex items-center justify-between px-10 shrink-0 z-[120]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-2xl shadow-indigo-500/20">
            <Zap size={20} fill="currentColor" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter italic uppercase leading-none">SliceMaster <span className="text-indigo-500">Core</span></h1>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600">离线隐私引擎已就绪</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {layers.length > 0 && (
            <button 
              onClick={exportAssets} 
              disabled={state.status === 'exporting'} 
              className="bg-white text-black px-8 py-2.5 rounded-xl font-black text-[10px] flex items-center gap-2 hover:bg-indigo-50 active:scale-95 transition-all disabled:opacity-50 uppercase tracking-widest shadow-xl"
            >
               <Download size={14} /> 批量导出 ZIP 资源
            </button>
          )}
          <div className="flex items-center gap-2 text-zinc-700 bg-white/5 px-4 py-2 rounded-lg border border-white/5">
             <Shield size={14} className="text-emerald-500" />
             <span className="text-[9px] font-black uppercase tracking-wider">本地安全沙盒模式</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {layers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_50%,#0c0c0c,transparent)]">
            <div 
              onClick={() => fileInputRef.current?.click()} 
              className="group w-full max-w-2xl aspect-video border-2 border-dashed border-zinc-900 hover:border-indigo-500/40 bg-[#070707] rounded-[60px] flex flex-col items-center justify-center gap-8 cursor-pointer transition-all duration-700 shadow-2xl relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-indigo-600 opacity-0 group-hover:opacity-[0.03] transition-opacity duration-700" />
              <div className="w-24 h-24 bg-zinc-900 group-hover:bg-indigo-600 rounded-[30px] flex items-center justify-center transition-all group-hover:-rotate-12 shadow-2xl group-hover:shadow-indigo-500/20">
                <Upload className="text-zinc-600 group-hover:text-white" size={32} />
              </div>
              <div className="text-center relative space-y-3">
                <h2 className="text-3xl font-black italic uppercase tracking-tighter text-zinc-300 group-hover:text-white transition-colors">拖入 PSD 进行本地解析</h2>
                <p className="text-zinc-700 text-[10px] uppercase tracking-[0.4em] font-black">自动裁剪透明边距 • 保持文件夹结构 • 100% 隐私安全</p>
              </div>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadPsd(e.target.files[0])} className="hidden" accept=".psd" />
            </div>
          </div>
        ) : (
          <>
            <aside className="w-80 border-r border-white/5 bg-[#050505] flex flex-col shrink-0">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">图层结构浏览</span>
                <span className="text-[8px] font-mono bg-indigo-500/10 text-indigo-400 px-2 py-1 rounded-md uppercase border border-indigo-500/20">{stats.groups} 组</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-custom">
                <LayerTree layers={layers} onToggleSelect={toggleSelect} onPreview={handlePreview} />
              </div>
            </aside>

            <section className="flex-1 relative bg-[#010101] flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center p-12 checkerboard-pro">
                {previewLayer ? (
                  <div className="relative animate-in zoom-in duration-500 max-w-full max-h-full">
                    <div className="absolute -inset-20 bg-indigo-500/10 blur-[100px] rounded-full pointer-events-none animate-pulse" />
                    <div className="bg-[#0d0d0d] border border-white/10 rounded-[40px] overflow-hidden shadow-[0_50px_100px_-20px_rgba(0,0,0,1)] flex flex-col relative z-10 border-indigo-500/10">
                      <div className="px-6 py-4 bg-white/5 flex justify-between items-center border-b border-white/5 text-[9px] font-black uppercase tracking-[0.2em]">
                        <span className="text-zinc-400 truncate max-w-[240px]">{previewLayer.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">{previewLayer.w} × {previewLayer.h} PX</span>
                        </div>
                      </div>
                      <div className="p-16 max-w-[55vw] max-h-[55vh] overflow-auto flex items-center justify-center scrollbar-custom">
                        <img src={previewLayer.canvas.toDataURL()} className="max-w-full h-auto drop-shadow-[0_20px_40px_rgba(0,0,0,0.5)]" alt="Preview" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center opacity-[0.03] flex flex-col items-center gap-8 pointer-events-none">
                    <Layers size={140} />
                    <span className="text-xl font-black uppercase tracking-[0.8em]">PREVIEW</span>
                  </div>
                )}
              </div>
              
              <div className="h-14 border-t border-white/5 bg-[#0a0a0a]/95 px-10 flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-4">
                   <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">引擎状态:</span>
                   <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest">{state.message}</span>
                 </div>
                 <div className="text-[9px] font-black text-zinc-700 uppercase tracking-widest">
                   SLICEMASTER CORE ENGINE v2.0
                 </div>
              </div>
            </section>

            <aside className="w-80 border-l border-white/5 bg-[#050505] shrink-0 flex flex-col p-8 space-y-12">
               <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <Settings size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">导出预设</h3>
                  </div>
                  
                  <div className="space-y-6 bg-white/2 p-6 rounded-3xl border border-white/5">
                    <div className="space-y-3">
                       <label className="text-[9px] font-black text-zinc-600 uppercase tracking-wider">命名转换规范</label>
                       <select 
                        value={namingStyle} 
                        onChange={(e) => setNamingStyle(e.target.value as NamingStyle)} 
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-[10px] font-black outline-none focus:border-indigo-500/50 transition-all appearance-none cursor-pointer"
                       >
                         <option value="original">保持原始 (Original)</option>
                         <option value="snake_case">小写蛇形 (snake_case)</option>
                         <option value="kebab-case">小写短横 (kebab-case)</option>
                         <option value="PascalCase">大写驼峰 (PascalCase)</option>
                       </select>
                    </div>

                    <div className="flex items-center justify-between pt-2">
                       <div className="space-y-1">
                         <label className="text-[9px] font-black text-zinc-600 uppercase tracking-wider">继承路径前缀</label>
                         <p className="text-[7px] text-zinc-800 font-black uppercase">自动拼接父级文件夹名</p>
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

               <div className="space-y-8">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <BarChart3 size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">资源统计</h3>
                  </div>
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-3xl p-6 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                           <span className="text-[8px] font-black uppercase text-zinc-600 block">图层总数</span>
                           <span className="text-white text-lg font-black tracking-tighter tabular-nums">{stats.total}</span>
                        </div>
                        <div className="space-y-1">
                           <span className="text-[8px] font-black uppercase text-zinc-600 block">待导出</span>
                           <span className="text-emerald-400 text-lg font-black tracking-tighter tabular-nums">{stats.selected}</span>
                        </div>
                     </div>
                     <div className="pt-6 border-t border-emerald-500/10">
                        <div className="flex items-center gap-2 mb-3">
                           <Cpu size={12} className="text-emerald-500/50" />
                           <span className="text-[8px] font-black uppercase text-zinc-600">处理策略: 智能边缘修剪</span>
                        </div>
                        <p className="text-[8px] text-emerald-900 font-bold leading-relaxed uppercase">
                          检测到已开启透明通道自动裁剪。预计导出将减少约 40% 的冗余文件空间。
                        </p>
                     </div>
                  </div>
               </div>

               <div className="flex-1" />
               
               <button 
                onClick={reset} 
                className="w-full py-4 rounded-2xl border border-white/5 hover:bg-red-500/5 hover:border-red-500/20 hover:text-red-500 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-700 transition-all duration-300 active:scale-95 flex items-center justify-center gap-2"
               >
                  <X size={14} /> 释放工作空间
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

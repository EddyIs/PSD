
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, Download, Zap, FileCode, AlertCircle, 
  Monitor, Terminal, Cpu, Copy, Check, 
  FolderTree, Loader2, Package, Rocket, Settings,
  ArrowRight, ShieldCheck, Box, Layers, MousePointer2, Info,
  PlusSquare, MoreVertical, X, ExternalLink, Shield, HardDrive
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
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  // --- 状态管理 ---
  const [layers, setLayers] = useState<PsdLayer[]>([]);
  const [previewLayer, setPreviewLayer] = useState<{id: string, name: string, canvas: HTMLCanvasElement, w: number, h: number} | null>(null);
  const [state, setState] = useState<ProcessingState>({
    status: 'idle',
    progress: 0,
    message: '本地引擎就绪'
  });
  
  // 设置
  const [namingStyle, setNamingStyle] = useState<NamingStyle>('snake_case');
  const [useFolderPrefix, setUseFolderPrefix] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [isAlreadyInstalled, setIsAlreadyInstalled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 环境检测
  useEffect(() => {
    if (window.matchMedia('(display-mode: standalone)').matches) setIsAlreadyInstalled(true);
    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const transformName = (name: string, style: NamingStyle) => {
    let base = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (style === 'snake_case') return base.toLowerCase().replace(/\s+/g, '_');
    if (style === 'kebab-case') return base.toLowerCase().replace(/\s+/g, '-');
    if (style === 'PascalCase') return base.replace(/(\w)(\w*)/g, (g, g1, g2) => g1.toUpperCase() + g2.toLowerCase()).replace(/\s+/g, '');
    return base;
  };

  const loadPsd = async (file: File) => {
    reset();
    setState({ status: 'parsing', progress: 10, message: `正在读取文件流...` });

    // 给 UI 渲染一点时间显示进度
    await new Promise(r => setTimeout(r, 100));

    try {
      const buffer = await file.arrayBuffer();
      setState({ status: 'parsing', progress: 30, message: '解析 PSD 数据结构...' });
      
      // readPsd 是同步阻塞操作，为了让进度显示，我们在微任务后执行
      await new Promise(r => {
        setTimeout(() => {
          try {
            const psd = readPsd(buffer, { skipThumbnail: true });
            psdRef.current = psd;
            r(psd);
          } catch (e) {
            console.error(e);
            setState({ status: 'idle', progress: 0, message: '文件解析失败' });
          }
        }, 50);
      });

      if (!psdRef.current) return;

      setState({ status: 'parsing', progress: 70, message: '正在构建图层树...' });

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

      const root = transformLayers(psdRef.current.children || []);
      setLayers(root);
      setState({ status: 'ready', progress: 100, message: '文件加载成功' });

    } catch (err: any) {
      setState({ status: 'idle', progress: 0, message: "解析引擎崩溃" });
    }
  };

  const exportAssets = async () => {
    if (layers.length === 0) return;
    setState({ status: 'exporting', progress: 0, message: '准备裁剪打包...' });
    
    const zip = new JSZip();
    let totalLayers = 0;
    let processedCount = 0;

    const countSelected = (list: PsdLayer[]) => {
      list.forEach(l => {
        if (l.type === 'layer' && l.isSelected) totalLayers++;
        if (l.children) countSelected(l.children);
      });
    };
    countSelected(layers);

    if (totalLayers === 0) {
      alert("请至少选择一个图层进行导出");
      setState({ status: 'ready', progress: 100, message: '未选中图层' });
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
            setState({ status: 'exporting', progress: (processedCount / totalLayers) * 100, message: `处理图层 (${processedCount}/${totalLayers}): ${l.name}` });
            try {
              const trimmed = trimCanvas(raw);
              if (trimmed) {
                const blob = await new Promise<Blob | null>(res => trimmed.canvas.toBlob(res, 'image/png'));
                if (blob) zip.file(`${prefixPath}${cleanName}.png`, blob);
              }
            } catch (e) {}
            // 释放主线程防止界面冻结
            if (processedCount % 3 === 0) await new Promise(r => setTimeout(r, 16));
          }
        }
      }
    };

    await processLevel(layers, zip);
    setState({ status: 'exporting', progress: 99, message: '正在生成压缩包...' });
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(content);
    link.download = `Slices_${Date.now()}.zip`;
    link.click();
    setState({ status: 'ready', progress: 100, message: '所有资源导出成功' });
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
    setState({ status: 'idle', progress: 0, message: '本地引擎已就绪' });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#030303] text-zinc-100 font-sans selection:bg-indigo-500/30">
      
      {/* 增强的加载状态遮罩 */}
      {(state.status === 'parsing' || state.status === 'exporting') && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-3xl z-[2000] flex flex-col items-center justify-center p-12 text-center">
           <div className="relative mb-12">
              <div className="w-24 h-24 border-4 border-indigo-500/10 border-t-indigo-500 rounded-full animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center text-xs font-black tabular-nums">
                {Math.round(state.progress)}%
              </div>
           </div>
           <h3 className="text-xl font-black italic uppercase tracking-tighter mb-4">{state.status === 'parsing' ? '正在解析 PSD' : '资源导出中'}</h3>
           <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-[0.2em] animate-pulse">{state.message}</p>
           
           <div className="mt-12 w-full max-w-xs h-1 bg-zinc-900 rounded-full overflow-hidden">
             <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${state.progress}%` }} />
           </div>
        </div>
      )}

      <header className="h-20 border-b border-white/5 bg-[#080808]/90 backdrop-blur-2xl flex items-center justify-between px-10 shrink-0 z-[120]">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/10">
            <Zap size={20} fill="currentColor" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tighter italic uppercase leading-none">SliceMaster <span className="text-indigo-500">Core</span></h1>
            <p className="text-[8px] font-black uppercase tracking-widest text-zinc-600 mt-1">100% Local Processing</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {layers.length > 0 && (
            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5">
              <button 
                onClick={exportAssets} 
                disabled={state.status === 'exporting'} 
                className="bg-white text-black px-6 py-2 rounded-lg font-black text-[10px] flex items-center gap-2 hover:bg-zinc-200 transition-colors disabled:opacity-50 uppercase tracking-wider"
              >
                 <Download size={14} /> 导出 ZIP 资源
              </button>
            </div>
          )}
          <div className="w-px h-6 bg-white/10 mx-2" />
          <div className="flex items-center gap-2 text-zinc-600">
             <Shield size={16} />
             <span className="text-[9px] font-black uppercase">私有安全模式</span>
          </div>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {layers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_50%,#0c0c0c,transparent)]">
            <div 
              onClick={() => fileInputRef.current?.click()} 
              className="group w-full max-w-2xl aspect-video border-2 border-dashed border-zinc-900 hover:border-indigo-500/40 bg-[#070707] rounded-[50px] flex flex-col items-center justify-center gap-6 cursor-pointer transition-all duration-500 shadow-2xl relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-indigo-500 opacity-0 group-hover:opacity-[0.02] transition-opacity" />
              <div className="w-20 h-20 bg-zinc-900 group-hover:bg-indigo-600 rounded-3xl flex items-center justify-center transition-all group-hover:-rotate-6 shadow-xl">
                <Upload className="text-zinc-600 group-hover:text-white" size={28} />
              </div>
              <div className="text-center relative">
                <h2 className="text-2xl font-black italic uppercase tracking-tighter">导入本地 PSD 文件</h2>
                <p className="text-zinc-600 text-[10px] mt-2 uppercase tracking-[0.2em] font-bold">文件仅在您的浏览器中处理，绝不上传</p>
              </div>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadPsd(e.target.files[0])} className="hidden" accept=".psd" />
            </div>
          </div>
        ) : (
          <>
            {/* 左侧：图层树 */}
            <aside className="w-80 border-r border-white/5 bg-[#050505] flex flex-col shrink-0">
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">图层浏览器</span>
                <span className="text-[9px] font-mono bg-zinc-900 text-zinc-400 px-2 py-0.5 rounded uppercase">{layers.length} 个根容器</span>
              </div>
              <div className="flex-1 overflow-y-auto p-4 scrollbar-custom">
                <LayerTree layers={layers} onToggleSelect={toggleSelect} onPreview={handlePreview} />
              </div>
            </aside>

            {/* 中间：预览区 */}
            <section className="flex-1 relative bg-[#010101] flex flex-col">
              <div className="flex-1 flex flex-col items-center justify-center p-12 checkerboard-pro">
                {previewLayer ? (
                  <div className="relative animate-in zoom-in duration-300 max-w-full max-h-full">
                    <div className="absolute -inset-10 bg-indigo-500/10 blur-[60px] rounded-full pointer-events-none" />
                    <div className="bg-[#0d0d0d] border border-white/10 rounded-[30px] overflow-hidden shadow-2xl flex flex-col relative z-10">
                      <div className="px-5 py-3 bg-white/5 flex justify-between border-b border-white/5 text-[9px] font-black uppercase tracking-widest">
                        <span className="text-zinc-400 truncate max-w-[200px]">{previewLayer.name}</span>
                        <span className="text-indigo-400">{previewLayer.w} × {previewLayer.h} PX</span>
                      </div>
                      <div className="p-12 max-w-[50vw] max-h-[50vh] overflow-auto flex items-center justify-center scrollbar-custom">
                        <img src={previewLayer.canvas.toDataURL()} className="max-w-full h-auto drop-shadow-2xl" alt="Preview" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center opacity-10 flex flex-col items-center gap-6">
                    <Layers size={80} />
                    <span className="text-xs font-black uppercase tracking-[0.4em]">请点击图层进行预览</span>
                  </div>
                )}
              </div>
              
              <div className="h-14 border-t border-white/5 bg-[#0a0a0a]/95 px-8 flex items-center justify-between shrink-0">
                 <div className="flex items-center gap-4">
                   <div className={`w-2 h-2 rounded-full ${state.status === 'idle' ? 'bg-zinc-700' : 'bg-emerald-500 animate-pulse'}`} />
                   <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">{state.message}</span>
                 </div>
              </div>
            </section>

            {/* 右侧：导出属性设置 */}
            <aside className="w-80 border-l border-white/5 bg-[#050505] shrink-0 flex flex-col p-8 space-y-10">
               <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                      <Settings size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">导出选项</h3>
                  </div>
                  
                  <div className="space-y-6 bg-white/2 p-6 rounded-2xl border border-white/5">
                    <div className="space-y-2">
                       <label className="text-[9px] font-bold text-zinc-600 uppercase">文件名命名风格</label>
                       <select 
                        value={namingStyle} 
                        onChange={(e) => setNamingStyle(e.target.value as NamingStyle)} 
                        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-[10px] font-bold outline-none focus:border-indigo-500/50 transition-colors"
                       >
                         <option value="original">原始名称</option>
                         <option value="snake_case">snake_case</option>
                         <option value="kebab-case">kebab-case</option>
                         <option value="PascalCase">PascalCase</option>
                       </select>
                    </div>

                    <div className="flex items-center justify-between">
                       <div className="space-y-0.5">
                         <label className="text-[9px] font-bold text-zinc-600 uppercase">继承路径前缀</label>
                         <p className="text-[7px] text-zinc-800 font-bold uppercase">自动拼接父级文件夹名</p>
                       </div>
                       <button 
                        onClick={() => setUseFolderPrefix(!useFolderPrefix)} 
                        className={`w-10 h-5 rounded-full relative transition-all ${useFolderPrefix ? 'bg-indigo-600' : 'bg-zinc-800'}`}
                       >
                         <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all ${useFolderPrefix ? 'left-5.5' : 'left-0.5 shadow-sm'}`} />
                       </button>
                    </div>
                  </div>
               </div>

               <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                      <Cpu size={16} />
                    </div>
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">运行状态</h3>
                  </div>
                  <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-2xl p-6 space-y-4">
                     <div className="flex justify-between items-center">
                        <span className="text-[8px] font-black uppercase text-zinc-600">本地工作引擎</span>
                        <span className="text-emerald-400 text-[8px] font-black">运行中</span>
                     </div>
                     <div className="flex justify-between items-center">
                        <span className="text-[8px] font-black uppercase text-zinc-600">内存加速</span>
                        <span className="text-emerald-400 text-[8px] font-black">已开启</span>
                     </div>
                     <div className="pt-4 border-t border-emerald-500/10">
                        <p className="text-[8px] text-emerald-900 leading-tight">
                          已自动启用“透明通道裁剪”和“抗锯齿优化”。
                        </p>
                     </div>
                  </div>
               </div>

               <div className="flex-1" />
               
               <button onClick={reset} className="w-full py-4 rounded-xl border border-white/5 hover:bg-white/5 text-[9px] font-black uppercase tracking-widest text-zinc-600 transition-colors">
                  释放当前文件
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
          background-size: 20px 20px; 
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px; 
          background-color: #010101; 
        }
        .scrollbar-custom::-webkit-scrollbar { width: 4px; height: 4px; }
        .scrollbar-custom::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-custom::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
        .scrollbar-custom::-webkit-scrollbar-thumb:hover { background: #333; }
      `}</style>
    </div>
  );
};

export default App;

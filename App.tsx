
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { 
  Upload, Download, Zap, FileCode, AlertCircle, 
  Monitor, Terminal, Cpu, Copy, Check, 
  FolderTree, Loader2, Package, Rocket, Settings, Sparkles,
  ArrowRight, ShieldCheck, Box, Layers, MousePointer2, Info,
  Share, PlusSquare, MoreVertical, X, ExternalLink
} from 'lucide-react';
import { trimCanvas } from './services/psdProcessor';
import { PsdLayer, ProcessingState } from './types';
import { LayerTree } from './components/LayerTree';
import { readPsd } from 'ag-psd';
import JSZip from 'jszip';
import { GoogleGenAI, Type } from "@google/genai";

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
    message: '系统就绪'
  });
  
  // 设置与 PWA
  const [namingStyle, setNamingStyle] = useState<NamingStyle>('snake_case');
  const [useFolderPrefix, setUseFolderPrefix] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showDesktopInfo, setShowDesktopInfo] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const [isAlreadyInstalled, setIsAlreadyInstalled] = useState(false);
  const [isIframe, setIsIframe] = useState(false);
  
  // AI 与交互
  const [copiedStep, setCopiedStep] = useState<number | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{folder: string, type: string, reason: string}[]>([]);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 监听环境
  useEffect(() => {
    // 检测是否在 Iframe 中（AI Studio 预览环境）
    if (window.self !== window.top) {
      setIsIframe(true);
    }

    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsAlreadyInstalled(true);
    }

    const handler = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstallClick = async () => {
    if (isIframe) {
      alert("当前处于预览窗口，请点击右上角的“新标签页打开”图标，在正式浏览器页面的地址栏查找安装图标。");
      return;
    }
    if (!deferredPrompt) {
      alert("浏览器尚未弹出安装请求。建议在独立 Chrome/Edge 窗口中使用。");
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setCanInstall(false);
      setDeferredPrompt(null);
      setIsAlreadyInstalled(true);
    }
  };

  const transformName = (name: string, style: NamingStyle) => {
    let base = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
    if (style === 'snake_case') return base.toLowerCase().replace(/\s+/g, '_');
    if (style === 'kebab-case') return base.toLowerCase().replace(/\s+/g, '-');
    if (style === 'PascalCase') return base.replace(/(\w)(\w*)/g, (g, g1, g2) => g1.toUpperCase() + g2.toLowerCase()).replace(/\s+/g, '');
    return base;
  };

  const copyToClipboard = (text: string, step: number) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(step);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  const loadPsd = async (file: File) => {
    reset();
    setState({ status: 'parsing', progress: 5, message: `挂载解析引擎: ${file.name}` });

    try {
      const buffer = await file.arrayBuffer();
      setState({ status: 'parsing', progress: 20, message: '读取数据...' });
      
      await new Promise(r => setTimeout(r, 200));

      let psd;
      try {
        psd = readPsd(buffer, { skipThumbnail: true });
        setState({ status: 'parsing', progress: 60, message: '分析结构...' });
      } catch (e) {
        psd = readPsd(buffer, { skipThumbnail: true, skipLayerImageData: true });
        // 如果报错且不是 iframe，提示安装
        if (!isIframe) setShowDesktopInfo(true);
      }

      psdRef.current = psd;
      
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
      setState({ status: 'ready', progress: 100, message: '就绪' });
      analyzeStructureWithAI(root);

    } catch (err: any) {
      setState({ status: 'idle', progress: 0, message: "解析失败" });
    }
  };

  const exportAssets = async () => {
    if (layers.length === 0) return;
    setState({ status: 'exporting', progress: 0, message: '打包中...' });
    
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
              message: `处理图层: ${l.name}` 
            });

            try {
              const trimmed = trimCanvas(raw);
              if (trimmed) {
                const blob = await new Promise<Blob | null>(res => trimmed.canvas.toBlob(res, 'image/png'));
                if (blob) {
                  const finalFileName = `${prefixPath}${cleanName}.png`;
                  currentZip.file(finalFileName, blob);
                }
              }
            } catch (e) {
              console.error("Export Error:", l.name);
            }
            if (processedCount % 5 === 0) await new Promise(r => setTimeout(r, 40));
          }
        }
      }
    };

    await processLevel(layers, zip);

    try {
      setState({ status: 'exporting', progress: 95, message: '最后打包...' });
      const content = await zip.generateAsync({ type: 'blob' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(content);
      link.download = `Slices_${Date.now()}.zip`;
      link.click();
      setState({ status: 'ready', progress: 100, message: '导出成功' });
    } catch (e) {
      setState({ status: 'idle', progress: 0, message: '导出失败，建议使用 Chrome 独立窗口' });
    }
  };

  const analyzeStructureWithAI = async (currentLayers: PsdLayer[]) => {
    if (currentLayers.length === 0) return;
    setIsAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `分析 PSD 命名并给出分类建议：${currentLayers.slice(0, 15).map(l => l.name).join(', ')}`;
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: { 
            type: Type.OBJECT, 
            properties: { 
              suggestions: { 
                type: Type.ARRAY, 
                items: { 
                  type: Type.OBJECT,
                  properties: {
                    folder: { type: Type.STRING },
                    type: { type: Type.STRING },
                    reason: { type: Type.STRING }
                  }
                } 
              } 
            }, 
            required: ["suggestions"] 
          }
        }
      });
      const result = JSON.parse(response.text || '{}');
      setAiSuggestions(result.suggestions || []);
    } catch (e) {} finally { setIsAiLoading(false); }
  };

  const handlePreview = useCallback((layer: PsdLayer) => {
    const raw = layerMapRef.current.get(layer.id);
    if (!raw) return;
    try {
      const trimmed = trimCanvas(raw);
      if (trimmed) {
        setPreviewLayer({
          id: layer.id,
          name: layer.name,
          canvas: trimmed.canvas,
          w: trimmed.width,
          h: trimmed.height
        });
      }
    } catch (e) {
      console.error("Preview Error:", e);
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
    setAiSuggestions([]);
    setState({ status: 'idle', progress: 0, message: '就绪' });
  };

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#030303] text-zinc-100 font-sans selection:bg-indigo-500/30">
      
      {/* 1. 解析进度蒙层 */}
      {state.status === 'parsing' && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-3xl z-[2000] flex flex-col items-center justify-center p-12">
          <div className="max-w-md w-full space-y-12 text-center animate-in fade-in duration-1000">
             <div className="relative inline-block">
                <div className="absolute inset-0 bg-indigo-500/10 blur-[100px] rounded-full scale-150" />
                <div className="relative w-32 h-32 border-4 border-white/5 border-t-indigo-500 rounded-full animate-spin mx-auto" />
                <div className="absolute inset-0 flex items-center justify-center text-3xl font-black">
                   {Math.round(state.progress)}%
                </div>
             </div>
             <div className="space-y-4">
                <h2 className="text-2xl font-black uppercase italic">Processing PSD</h2>
                <p className="text-zinc-500 font-bold tracking-widest text-[9px]">{state.message}</p>
             </div>
          </div>
        </div>
      )}

      {/* 2. 可视化安装引导 - 仅在非 Iframe 且未安装时主动显示 */}
      {showDesktopInfo && (
        <div className="fixed inset-0 bg-black/98 backdrop-blur-[100px] z-[1000] flex items-center justify-center p-6">
          <div className="max-w-4xl w-full bg-[#090909] border border-white/10 rounded-[60px] p-12 shadow-2xl relative">
            <button onClick={() => setShowDesktopInfo(false)} className="absolute top-10 right-10 p-2 text-zinc-600 hover:text-white">
              <X size={24} />
            </button>
            
            <div className="flex flex-col items-center text-center space-y-10">
              <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-2xl rotate-6">
                <Monitor className="text-white" size={40} />
              </div>
              <div className="space-y-3">
                <h2 className="text-4xl font-black tracking-tighter">安装专业版指南</h2>
                <p className="text-zinc-500 text-sm max-w-2xl">预览环境下无法直接安装，请参考以下操作：</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
                 <div className="bg-zinc-900/40 p-8 rounded-[40px] border border-white/5 text-left space-y-4">
                    <h3 className="font-black text-xs uppercase text-indigo-400">步骤 1：脱离预览窗口</h3>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                       点击右上角的“弹出按钮” <ExternalLink size={12} className="inline mx-1"/> 将此应用在独立浏览器标签页打开。
                    </p>
                 </div>
                 <div className="bg-zinc-900/40 p-8 rounded-[40px] border border-white/5 text-left space-y-4">
                    <h3 className="font-black text-xs uppercase text-emerald-400">步骤 2：查找地址栏</h3>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">
                       在独立标签页的地址栏右侧，会出现一个“屏幕+箭头”的图标，点击它即可完成安装。
                    </p>
                 </div>
              </div>

              <button onClick={() => setShowDesktopInfo(false)} className="w-full py-6 rounded-3xl font-black text-sm bg-white text-black hover:scale-[1.01] transition-all">
                我知道了，先用网页版干活
              </button>
            </div>
          </div>
        </div>
      )}

      {/* --- 主界面 --- */}
      <header className="h-24 border-b border-white/5 bg-[#080808]/90 backdrop-blur-3xl flex items-center justify-between px-12 shrink-0 z-[120]">
        <div className="flex items-center gap-6">
          <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-2xl">
            <Zap className="text-white" size={28} fill="currentColor" />
          </div>
          <div className="space-y-0.5">
            <h1 className="text-2xl font-black tracking-tighter italic">SliceMaster <span className="text-indigo-500">PRO</span></h1>
            <div className="flex items-center gap-2">
               <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
               <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest">智能分层切图系统</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {!isAlreadyInstalled && !isIframe && canInstall && (
            <button 
              onClick={handleInstallClick}
              className="px-6 py-2.5 bg-indigo-600 text-[10px] font-black rounded-xl hover:bg-indigo-500 transition-all shadow-lg"
            >
              安装专业版
            </button>
          )}
          
          {layers.length > 0 && (
            <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-xl border border-white/5">
              <button 
                onClick={() => setShowSettings(!showSettings)}
                className={`p-2.5 rounded-lg transition-all ${showSettings ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-white'}`}
              >
                <Settings size={18} />
              </button>
              <button 
                onClick={exportAssets} 
                disabled={state.status === 'exporting'} 
                className="bg-white text-black px-8 py-2.5 rounded-lg font-black text-[11px] flex items-center gap-2 hover:scale-105 active:scale-95 disabled:opacity-50"
              >
                 {state.status === 'exporting' ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                 一键切图
              </button>
            </div>
          )}
          <button onClick={() => setShowDesktopInfo(true)} className="p-3 text-zinc-600 hover:text-indigo-400 bg-white/5 border border-white/5 rounded-xl transition-all">
            <Info size={20} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {layers.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center bg-[radial-gradient(circle_at_50%_50%,#0c0c0c,transparent)]">
            <div 
              onClick={() => fileInputRef.current?.click()}
              className="group w-full max-w-4xl aspect-[16/10] border-2 border-dashed border-zinc-900 hover:border-indigo-500/40 bg-[#070707] rounded-[80px] flex flex-col items-center justify-center gap-12 cursor-pointer transition-all duration-700 shadow-2xl relative overflow-hidden"
            >
              <div className="w-32 h-32 bg-zinc-900 group-hover:bg-indigo-600 rounded-[40px] flex items-center justify-center transition-all duration-700 group-hover:-rotate-12">
                <Upload className="text-zinc-600 group-hover:text-white" size={48} />
              </div>
              <div className="text-center space-y-5">
                <h2 className="text-5xl font-black text-white italic uppercase tracking-tighter">Drop PSD File</h2>
                <p className="text-zinc-600 font-medium text-lg max-w-sm mx-auto">自动裁剪透明通道，智能分组归类导出 PNG 资源</p>
              </div>
              <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && loadPsd(e.target.files[0])} className="hidden" accept=".psd" />
            </div>

            {/* 底部引导，不再强制弹窗 */}
            <div className="mt-12 flex items-center gap-6 bg-white/5 px-8 py-4 rounded-3xl border border-white/5">
               <Package className="text-indigo-400" size={20} />
               <p className="text-[11px] text-zinc-500">遇到大文件崩溃？在正式浏览器标签页中开启安装，可解除内存限制。</p>
               <button onClick={() => setShowDesktopInfo(true)} className="text-[11px] font-black text-zinc-400 underline">详细操作</button>
            </div>
          </div>
        ) : (
          <>
            <aside className="w-[360px] border-r border-white/5 bg-[#050505] flex flex-col shrink-0">
              <div className="p-10 border-b border-white/5 flex items-center justify-between">
                <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-700">Layers Tree</span>
                <span className="text-[10px] font-mono text-indigo-400">{layers.length} 根对象</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6 scrollbar-custom">
                <LayerTree layers={layers} onToggleSelect={toggleSelect} onPreview={handlePreview} />
              </div>
            </aside>

            <section className="flex-1 relative bg-[#010101] flex flex-col">
              {showSettings && (
                <div className="absolute top-6 right-6 z-[200] w-72 bg-[#111] border border-white/10 rounded-[30px] p-8 shadow-3xl animate-in fade-in slide-in-from-top-4">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-600 mb-6 pb-2 border-b border-white/5">Export Config</h4>
                  <div className="space-y-8">
                    <div className="space-y-3">
                       <label className="text-[10px] font-bold text-zinc-500 uppercase">命名转换</label>
                       <select 
                        value={namingStyle}
                        onChange={(e) => setNamingStyle(e.target.value as NamingStyle)}
                        className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-[11px] text-white outline-none"
                       >
                         <option value="original">原始 (Original)</option>
                         <option value="snake_case">snake_case</option>
                         <option value="kebab-case">kebab-case</option>
                         <option value="PascalCase">PascalCase</option>
                       </select>
                    </div>
                    <div className="flex items-center justify-between">
                       <label className="text-[10px] font-bold text-zinc-500 uppercase">继承前缀</label>
                       <button 
                        onClick={() => setUseFolderPrefix(!useFolderPrefix)}
                        className={`w-12 h-6 rounded-full relative transition-all ${useFolderPrefix ? 'bg-indigo-600' : 'bg-zinc-800'}`}
                       >
                         <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${useFolderPrefix ? 'left-7' : 'left-1'}`} />
                       </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex-1 flex flex-col items-center justify-center p-20 checkerboard-pro">
                {previewLayer ? (
                  <div className="relative group animate-in zoom-in duration-500 w-full h-full flex items-center justify-center">
                    <div className="absolute -inset-40 bg-indigo-500/5 blur-[120px] rounded-full" />
                    <div className="relative bg-[#0d0d0d] border border-white/10 rounded-[50px] overflow-hidden shadow-2xl max-w-full max-h-full">
                      <div className="px-8 py-4 bg-white/5 flex justify-between items-center border-b border-white/5">
                         <span className="text-xs font-black text-white truncate max-w-[200px]">{previewLayer.name}</span>
                         <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full">
                            {previewLayer.w} × {previewLayer.h} PX
                         </span>
                      </div>
                      <div className="p-16 max-w-[70vw] max-h-[60vh] overflow-auto flex items-center justify-center">
                        <img src={previewLayer.canvas.toDataURL()} className="max-w-full h-auto" />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-6 opacity-[0.02]">
                    <Layers size={180} />
                  </div>
                )}
              </div>

              <div className="h-20 border-t border-white/5 bg-[#0a0a0a]/98 backdrop-blur-3xl px-12 flex items-center justify-between">
                 <div className="flex items-center gap-8">
                    <div className="flex flex-col">
                       <span className="text-[8px] font-black text-zinc-700 uppercase tracking-widest">Engine Load</span>
                       <span className="text-[11px] font-black text-zinc-400 uppercase">{state.message}</span>
                    </div>
                 </div>
                 {(state.status === 'exporting' || state.status === 'parsing') && (
                   <div className="flex items-center gap-8">
                      <div className="w-80 h-1 bg-zinc-950 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all duration-300" style={{ width: `${state.progress}%` }} />
                      </div>
                      <span className="text-[11px] font-black text-indigo-400 tabular-nums">{Math.round(state.progress)}%</span>
                   </div>
                 )}
              </div>
            </section>

            <aside className="w-[380px] border-l border-white/5 bg-[#050505] shrink-0 flex flex-col">
              <div className="p-12 space-y-16 overflow-y-auto flex-1 scrollbar-custom">
                <div className="space-y-8">
                   <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400 border border-indigo-500/10">
                        <Sparkles size={16} />
                      </div>
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600">AI 归类专家</h3>
                   </div>
                   <div className="space-y-4">
                     {isAiLoading ? (
                       <div className="space-y-6 animate-pulse p-4">
                         {[1, 2].map(i => <div key={i} className="h-20 bg-zinc-900/50 rounded-3xl" />)}
                       </div>
                     ) : aiSuggestions.length > 0 ? (
                       aiSuggestions.map((s, i) => (
                         <div key={i} className="bg-[#0c0c0c] border border-white/5 rounded-[30px] p-6">
                            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest px-3 py-1 bg-indigo-500/10 rounded-lg mb-3 inline-block">{s.type}</span>
                            <h5 className="text-[11px] font-black text-zinc-200 mb-2">{s.folder}</h5>
                            <p className="text-[10px] text-zinc-600 leading-relaxed">{s.reason}</p>
                         </div>
                       ))
                     ) : (
                       <div className="bg-black/40 border border-white/5 border-dashed rounded-[30px] p-10 text-center">
                          <p className="text-[10px] text-zinc-800 font-bold italic">导入后开启 AI 建议</p>
                       </div>
                     )}
                   </div>
                </div>

                <div className="space-y-8">
                   <div className="flex items-center gap-4">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400 border border-emerald-500/10">
                        <Cpu size={16} />
                      </div>
                      <h3 className="text-[11px] font-black uppercase tracking-[0.2em] text-zinc-600">资源面板</h3>
                   </div>
                   <div className="bg-emerald-500/5 border border-emerald-500/10 rounded-[35px] p-10 space-y-6">
                      <p className="text-[10px] text-zinc-600 leading-relaxed">
                        内存权限状态：<span className="text-emerald-400">{isAlreadyInstalled ? 'UNLIMITED' : 'BROWSER_LIMIT'}</span>
                      </p>
                      <button onClick={() => setShowDesktopInfo(true)} className="w-full bg-white/5 hover:bg-white/10 py-4 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all">
                        安装指南
                      </button>
                   </div>
                </div>
              </div>
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
          background-size: 30px 30px;
          background-position: 0 0, 0 15px, 15px -15px, -15px 0px;
          background-color: #010101;
        }
        .scrollbar-custom::-webkit-scrollbar { width: 5px; height: 5px; }
        .scrollbar-custom::-webkit-scrollbar-track { background: transparent; }
        .scrollbar-custom::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 10px; }
      `}</style>
    </div>
  );
};

export default App;

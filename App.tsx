
import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  Search, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Download,
  RotateCcw,
  ExternalLink,
  Maximize2,
  X,
  ArrowRight,
  FileText,
  Image as ImageIcon,
  Layers,
  Flag,
  Save,
  Edit3,
  Globe,
  ShieldCheck,
  Zap,
  Cpu,
  Table,
  BrainCircuit,
  Binary,
  Link2
} from 'lucide-react';
import { EnrichedComponentData, ProcessingStats } from './types';
import { parseExcelFile, exportToExcel } from './services/excelService';
import { enrichComponentInfo } from './services/geminiService';

const PartlyLogo = () => (
  <div className="flex items-center justify-center mr-4 w-12 h-12 bg-black rounded-xl overflow-hidden shadow-lg group transition-all hover:scale-105 active:scale-95">
    <svg viewBox="0 0 100 100" className="w-8 h-8 text-white transition-transform duration-500 group-hover:rotate-12">
      <rect x="20" y="30" width="60" height="50" rx="8" fill="currentColor" />
      <rect x="47" y="15" width="6" height="15" fill="currentColor" />
      <circle cx="50" cy="15" r="5" fill="currentColor" />
      <rect x="30" y="42" width="40" height="12" rx="4" fill="black" />
      <circle cx="40" cy="48" r="3" fill="#4ade80" className="animate-pulse" />
      <circle cx="60" cy="48" r="3" fill="#4ade80" className="animate-pulse" />
      <rect x="12" y="45" width="8" height="20" rx="2" fill="currentColor" />
      <rect x="80" y="45" width="8" height="20" rx="2" fill="currentColor" />
    </svg>
  </div>
);

const App: React.FC = () => {
  const [data, setData] = useState<EnrichedComponentData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<EnrichedComponentData | null>(null);
  const [viewMode, setViewMode] = useState<'content' | 'corpus' | 'reasoning' | 'verification'>('content');
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats: ProcessingStats = {
    total: data.length,
    completed: data.filter(d => d.status === 'completed').length,
    errors: data.filter(d => d.status === 'error').length
  };

  const startEnrichment = async (items: EnrichedComponentData[]) => {
    if (isProcessing) return;
    setIsProcessing(true);
    setError(null);

    for (let i = 0; i < items.length; i++) {
      if (items[i].status === 'completed') continue;

      setData(prev => prev.map((item, idx) => 
        idx === i ? { ...item, status: 'processing' } : item
      ));

      try {
        const result = await enrichComponentInfo(items[i].mpn, items[i].manufacturer);
        setData(prev => prev.map((item, idx) => 
          idx === i ? { 
            ...item, 
            status: 'completed', 
            ...result
          } : item
        ));
      } catch (err: any) {
        setData(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: 'error', error: err.message, confidence: 'low' } : item
        ));
      }
    }
    setIsProcessing(false);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setError(null);
    setData([]); 

    try {
      const rawData = await parseExcelFile(file);
      const initialEnrichedData: EnrichedComponentData[] = rawData.map(item => ({
        ...item,
        description: '',
        features: [],
        sources: [],
        citationMap: {},
        status: 'pending',
        flags: [],
        sourceCount: 0
      }));
      setData(initialEnrichedData);
      startEnrichment(initialEnrichedData);
    } catch (err: any) {
      setError(err.message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Helper to render text with citation tooltips
  const renderTextWithCitations = (text: string) => {
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, idx) => {
      const citationMatch = part.match(/\[(\d+)\]/);
      if (citationMatch) {
        const id = parseInt(citationMatch[1]);
        const url = selectedItem?.citationMap[id];
        return (
          <a
            key={idx}
            href={url}
            target="_blank"
            onMouseEnter={() => setActiveSourceId(id)}
            onMouseLeave={() => setActiveSourceId(null)}
            className="inline-flex items-center justify-center w-5 h-5 bg-zinc-100 text-[9px] font-black rounded-full ml-1 hover:bg-black hover:text-white transition-all cursor-help no-underline border border-zinc-200"
          >
            {id}
          </a>
        );
      }
      return part;
    });
  };

  return (
    <div className="min-h-screen bg-white text-black font-sans selection:bg-black selection:text-white flex flex-col">
      <input ref={fileInputRef} type="file" accept=".xlsx, .xls, .csv" className="hidden" onChange={handleFileUpload} />

      <nav className="border-b border-black h-20 sticky top-0 z-40 bg-white shadow-sm">
        <div className="max-w-screen-2xl mx-auto px-8 h-full flex items-center justify-between">
          <div className="flex items-center">
            <PartlyLogo />
            <h1 className="text-3xl font-black tracking-tighter pt-1 uppercase select-none">Partly</h1>
          </div>
          <div className="flex items-center gap-4">
            {data.length > 0 && (
              <>
                <button onClick={() => setData([])} className="p-2 text-zinc-400 hover:text-black transition-colors"><RotateCcw className="w-5 h-5" /></button>
                <button onClick={() => fileInputRef.current?.click()} className="px-6 py-2.5 text-[10px] font-black bg-blue-600 text-white hover:bg-blue-700 uppercase tracking-widest transition-all">New Batch</button>
                <button onClick={() => exportToExcel(data)} className="px-6 py-2.5 text-[10px] font-black bg-green-600 text-white hover:bg-green-700 uppercase tracking-widest transition-all">Export Excel</button>
                {isProcessing && <Loader2 className="w-5 h-5 animate-spin text-blue-600 ml-4" />}
              </>
            )}
          </div>
        </div>
      </nav>

      <main className="flex-grow max-w-screen-2xl mx-auto px-8 py-8 w-full">
        {data.length === 0 ? (
          <div className="max-w-4xl mx-auto mt-24 text-center space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <h2 className="text-5xl md:text-7xl font-black tracking-tighter leading-none uppercase">SurgePure Engine</h2>
            <p className="text-xl text-zinc-500 font-medium tracking-tight">Technical Spec Enrichment via Deterministic Scraper Logic.</p>
            <button onClick={() => fileInputRef.current?.click()} className="max-w-md mx-auto py-8 bg-black text-white flex items-center justify-center gap-6 hover:bg-zinc-900 transition-all w-full shadow-2xl">
              <Upload className="w-8 h-8" />
              <span className="text-2xl font-black uppercase">Upload Excel Batch</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-4 border border-black bg-zinc-50 shadow-sm">
              <div className="px-8 py-4 border-r border-black"><p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">Total SKU</p><p className="text-3xl font-black">{stats.total}</p></div>
              <div className="px-8 py-4 border-r border-black"><p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">Enriched</p><p className="text-3xl font-black">{stats.completed}</p></div>
              <div className="px-8 py-4 border-r border-black"><p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">Issues</p><p className="text-3xl font-black text-zinc-200">{stats.errors}</p></div>
              <div className="px-8 py-4"><p className="text-[9px] font-black text-zinc-400 uppercase tracking-[0.2em] mb-1">Yield</p><p className="text-3xl font-black">{data.length ? Math.round((stats.completed/data.length)*100) : 0}%</p></div>
            </div>

            <div className="border border-black overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b border-black bg-white">
                    <th className="px-3 py-4 text-[10px] font-black uppercase tracking-widest w-[130px]">MPN</th>
                    <th className="px-3 py-4 text-[10px] font-black uppercase tracking-widest w-[150px]">Manufacturer</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-center">Data Quality</th>
                    <th className="px-4 py-4 text-[10px] font-black uppercase tracking-widest text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200">
                  {data.map((item, idx) => (
                    <tr key={idx} className="hover:bg-zinc-50">
                      <td className="px-3 py-4 font-mono text-[10px] font-bold">{item.mpn}</td>
                      <td className="px-3 py-4 text-[10px] font-black uppercase opacity-60">{item.manufacturer}</td>
                      <td className="px-3 py-4 text-center">
                        {item.status === 'completed' ? (
                          <div className={`inline-block w-2 h-2 rounded-full ${item.confidence === 'high' ? 'bg-green-500' : 'bg-amber-500'}`} title={item.confidence} />
                        ) : '---'}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {item.status === 'completed' ? (
                          <button onClick={() => { setSelectedItem(item); setViewMode('content'); }} className="px-4 py-1.5 bg-black text-white text-[9px] font-black uppercase tracking-widest">Open Report</button>
                        ) : <span className="text-[8px] font-black text-zinc-300 uppercase italic">{item.status}...</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-8 bg-black/80 backdrop-blur-sm">
          <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] shadow-2xl overflow-hidden flex border border-black">
            <div className="w-72 border-r border-zinc-100 bg-zinc-50 p-8 space-y-8 flex flex-col">
              <div>
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-6">Discovery Assets</p>
                <div className="aspect-square bg-white border border-zinc-100 mb-6 flex items-center justify-center overflow-hidden">
                  {selectedItem.imageUrl ? <img src={selectedItem.imageUrl} className="w-full h-full object-contain p-4" /> : <ImageIcon className="w-12 h-12 text-zinc-100" />}
                </div>
                <div className="space-y-2">
                  <a href={selectedItem.datasheetUrl} target="_blank" className="w-full flex items-center justify-between px-4 py-2.5 bg-black text-white text-[9px] font-black uppercase tracking-widest hover:bg-zinc-800 transition-all">Datasheet <ExternalLink className="w-3.5 h-3.5"/></a>
                </div>
              </div>
              <div className="flex-grow overflow-y-auto minimal-scrollbar">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-4">Grounding Sources</p>
                <div className="space-y-2">
                  {Object.entries(selectedItem.citationMap).map(([idStr, uri]) => {
                    const id = parseInt(idStr);
                    const isHighlighted = activeSourceId === id;
                    return (
                      <a 
                        key={id} 
                        href={uri} 
                        target="_blank" 
                        className={`block p-3 border transition-all ${isHighlighted ? 'bg-black text-white border-black scale-105 shadow-lg z-10' : 'bg-white border-zinc-100 text-zinc-700 hover:border-black'}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-[8px] px-1 rounded-sm font-black ${isHighlighted ? 'bg-white text-black' : 'bg-zinc-100 text-zinc-400'}`}>[{id}]</span>
                          <Link2 className="w-3 h-3" />
                        </div>
                        <p className="text-[9px] font-bold truncate leading-tight uppercase tracking-tighter">{uri}</p>
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex-grow flex flex-col bg-white">
              <div className="px-12 py-8 border-b border-zinc-100 flex items-center justify-between">
                <div>
                  <h3 className="text-3xl font-black uppercase tracking-tighter">{selectedItem.mpn}</h3>
                  <div className="flex gap-6 mt-4">
                    <button onClick={() => setViewMode('content')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${viewMode === 'content' ? 'border-black' : 'border-transparent text-zinc-300'}`}>Content</button>
                    <button onClick={() => setViewMode('reasoning')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${viewMode === 'reasoning' ? 'border-black' : 'border-transparent text-zinc-300'}`}>Scraper Thought Process</button>
                    <button onClick={() => setViewMode('corpus')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${viewMode === 'corpus' ? 'border-black' : 'border-transparent text-zinc-300'}`}>Grounding Corpus</button>
                    <button onClick={() => setViewMode('verification')} className={`text-[10px] font-black uppercase tracking-widest pb-1 border-b-2 ${viewMode === 'verification' ? 'border-black' : 'border-transparent text-zinc-300'}`}>Audit Log</button>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)}><X className="w-8 h-8" /></button>
              </div>

              <div className="flex-grow overflow-y-auto p-16 minimal-scrollbar">
                <div className="max-w-4xl mx-auto">
                  {viewMode === 'reasoning' ? (
                    <div className="space-y-8 animate-in fade-in">
                      <div className="flex items-center gap-4 text-blue-600">
                        <BrainCircuit className="w-8 h-8" />
                        <span className="text-xs font-black uppercase tracking-widest">AI Agent Reasoning Sequence</span>
                      </div>
                      <div className="p-10 bg-zinc-50 border border-zinc-200 rounded-sm leading-relaxed text-zinc-700 font-medium italic">
                        {selectedItem.reasoning}
                      </div>
                    </div>
                  ) : viewMode === 'corpus' ? (
                    <div className="space-y-8 animate-in fade-in">
                      <div className="flex items-center gap-4 text-red-600">
                        <Binary className="w-8 h-8" />
                        <span className="text-xs font-black uppercase tracking-widest">Raw Extraction Grounding</span>
                      </div>
                      <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-600 bg-zinc-50 p-10 border border-zinc-200">{selectedItem.corpus}</pre>
                    </div>
                  ) : viewMode === 'verification' ? (
                    <div className="space-y-6 animate-in fade-in">
                      {selectedItem.flags.map((flag, i) => (
                        <div key={i} className="flex gap-4 p-4 bg-zinc-50 border border-zinc-100">
                          <Flag className="w-4 h-4 text-zinc-300 mt-1" />
                          <p className="text-sm font-medium">{flag}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-16">
                      {/* Section 1: Features (Bulleted) */}
                      <section>
                        <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-8 border-b pb-4">Features</h4>
                        <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-4">
                          {selectedItem.features.map((feature, i) => (
                            <li 
                              key={i} 
                              className="flex items-start gap-4 p-2 transition-all hover:bg-zinc-50 group"
                            >
                              <Zap className="w-4 h-4 text-blue-500 mt-1 shrink-0" />
                              <span className="text-lg font-medium text-zinc-800">
                                {renderTextWithCitations(feature)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </section>

                      {/* Section 2: Overview (200-500 words) */}
                      <section>
                        <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-8 border-b pb-4">Overview</h4>
                        <div className="prose prose-zinc max-w-none">
                          {selectedItem.description.split('\n').map((line, i) => (
                            <p key={i} className="text-xl font-medium leading-relaxed text-zinc-700 mb-8 last:mb-0 transition-all p-2 hover:bg-zinc-50">
                              {renderTextWithCitations(line)}
                            </p>
                          ))}
                        </div>
                      </section>
                      
                      {/* Section 3: Technical Specs (Table) */}
                      {selectedItem.specTable && (
                        <section>
                          <h4 className="text-[11px] font-black uppercase tracking-[0.3em] text-zinc-400 mb-8 border-b pb-4">Specifications</h4>
                          <table className="w-full border border-black shadow-xl">
                            <thead>
                              <tr className="bg-black text-white text-[10px] font-black uppercase tracking-widest">
                                <th className="px-6 py-4 text-left">Attribute</th>
                                <th className="px-6 py-4 text-left">Value</th>
                                <th className="px-6 py-4 text-left">Unit</th>
                                <th className="px-6 py-4 text-left">Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {selectedItem.specTable.map((s, i) => (
                                <tr 
                                  key={i} 
                                  className="border-b border-zinc-100 hover:bg-zinc-50 group transition-colors"
                                  onMouseEnter={() => s.sourceId && setActiveSourceId(s.sourceId)}
                                  onMouseLeave={() => setActiveSourceId(null)}
                                >
                                  <td className="px-6 py-4 text-[10px] font-black text-zinc-400 uppercase">{s.attribute}</td>
                                  <td className="px-6 py-4 text-sm font-bold font-mono">{s.value}</td>
                                  <td className="px-6 py-4 text-[10px] font-black text-zinc-300">{s.unit}</td>
                                  <td className="px-6 py-4">
                                    {s.sourceId && (
                                      <span className="text-[9px] px-1.5 py-0.5 bg-zinc-100 text-zinc-400 font-black rounded-sm border border-zinc-200">
                                        [{s.sourceId}]
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </section>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="px-12 py-10 bg-zinc-50 border-t border-zinc-100 flex justify-between items-center">
                <p className="text-[9px] font-medium text-zinc-400 uppercase tracking-widest italic">Source highlighting active. Hover over text segments or [ID] tags to view evidence.</p>
                <button onClick={() => setSelectedItem(null)} className="px-16 py-4 bg-black text-white text-[11px] font-black uppercase tracking-[0.3em] hover:bg-zinc-800 transition-all">Close Report</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;

import {Scope,type Disposer} from './scope.js';
import type {Json} from './protocol.js';

export type PluginThemeMode = 'dark' | 'light';
export type PluginPanelParams = Readonly<Record<string, Json>>;

export interface PluginUiServices {
  /** 在宿主界面的右下角或操作条展示轻量提示 */
  notify?(message: string, tone?: 'info' | 'success' | 'warning' | 'error'): void;
  /** 请求宿主打开指定扩展面板（可附带自定义参数） */
  openPanel?(panelId: string, params?: Record<string, Json>): void;
  /** 关闭当前已打开的扩展面板 */
  closePanel?(panelId?: string): void;
  /** 读取当前工作台外观主题（暗色 / 亮色） */
  getTheme?(): PluginThemeMode;
}

export interface PluginComposerServices {
  /** 将引用片段或模板文本插入当前会话输入框 */
  insertText(text: string): void;
  /** 以编程方式向当前会话发送消息 */
  submit?(text?: string): void | Promise<void>;
}

export interface AppIdentity {pluginId:string; generation:number; version:string}
export interface AppPanelProps {
  workspaceId?:string;
  sessionId?:string;
  visible?:boolean;
  /** 当前渲染的面板贡献点 id */
  panelId?:string;
  /** 当前宿主分辨率与外观模式 */
  theme?:PluginThemeMode;
  /** 宿主或其他插件传入的通用上下文参数 */
  params?:PluginPanelParams;
  initialUrl?:string;
  fileTarget?:{path:string};
  onTitle?:(title:string)=>void;
  onNavigate?:(url:string)=>void;
  emptyState?:unknown;
}
export interface DesktopServices {readonly available:boolean;invoke(command:string,args?:Record<string,unknown>):Promise<unknown>;streamChannel():{events:{id:string;onmessage?:(event:any)=>void};dispose():void}}
export type AppComponent=(props:AppPanelProps)=>unknown;
export interface AppContext {
  readonly identity:Readonly<AppIdentity>;
  readonly scope:Scope;
  readonly config:Readonly<Record<string,Json>>;
  readonly panels:{register(id:string,component:AppComponent):void};
  readonly commands:{register(id:string,run:()=>void|Promise<void>):void};
  readonly settings:{register(id:string,component:AppComponent):void};
  readonly services:{
    workbench:{snapshot():Json; subscribe(listener:()=>void):Disposer;request?(endpoint:string,body?:Json):Promise<Json>};
    desktop?:DesktopServices;
    /** 通用宿主界面交互桥接（通知、面板切换、主题查询） */
    ui?:PluginUiServices;
    /** 与当前对话输入框交互的能力 */
    composer?:PluginComposerServices;
    invokeWorker(handler:string,input?:Json,workspaceId?:string):Promise<Json>;
  };
  readonly hooks:{on(event:string,listener:(payload:Json)=>void|Promise<void>):void};
}
export interface AppDefinition {readonly apiVersion:'0.1';activate(ctx:AppContext):void|Disposer|Promise<void|Disposer>}
export function defineApp(activate:AppDefinition['activate']):AppDefinition {return Object.freeze({apiVersion:'0.1',activate});}
export interface AppRegistration {identity:AppIdentity;panels:Map<string,AppComponent>;commands:Map<string,()=>void|Promise<void>>;settings:Map<string,AppComponent>;hooks:Map<string,Set<(payload:Json)=>void|Promise<void>>>;scope:Scope}

/** Activation builds a private candidate. Publication never exposes partial registrations. */
export class AppRuntime {
  readonly #active=new Map<string,AppRegistration>();
  readonly #listeners=new Set<()=>void>();
  #snapshot:readonly AppRegistration[]=[];
  constructor(readonly report:(error:unknown)=>void=()=>{}){}
  readonly subscribe=(listener:()=>void):Disposer=>{const subscription=()=>listener();this.#listeners.add(subscription);return ()=>{this.#listeners.delete(subscription);};};
  readonly snapshot=():readonly AppRegistration[]=>this.#snapshot;
  #changed(){this.#snapshot=[...this.#active.values()];for(const listener of this.#listeners)listener();}
  async prepare(identity:AppIdentity,definition:AppDefinition,services:AppContext['services'],declarations:readonly {id:string;kind:string}[],config:Readonly<Record<string,Json>>={}):Promise<AppRegistration> {
    if(definition?.apiVersion!=='0.1'||typeof definition.activate!=='function')throw Error('App must export defineApp() as default');
    const scope=new Scope();
    const candidate:AppRegistration={identity,scope,panels:new Map(),commands:new Map(),settings:new Map(),hooks:new Map()};
    let registering=true;
    const register=<T>(kind:string,registry:Map<string,T>,id:string,value:T)=>{
      if(!registering)throw Error('Registration is closed');
      if(!declarations.some(item=>item.id===id&&item.kind===kind))throw Error(`Undeclared contribution: ${id}`);
      if(registry.has(id)||typeof value!=='function')throw Error(`Invalid or duplicate registration: ${id}`);
      registry.set(id,value);
    };
    try {
      const cleanup=await definition.activate(Object.freeze({identity:Object.freeze({...identity}),scope,config:Object.freeze(structuredClone(config)),
        panels:{register:(id:string,value:AppComponent)=>register('app.panel',candidate.panels,id,value)},
        commands:{register:(id:string,value:()=>void|Promise<void>)=>register('app.command',candidate.commands,id,value)},
        settings:{register:(id:string,value:AppComponent)=>register('settings.section',candidate.settings,id,value)},
        services:{...services,workbench:{...services.workbench,snapshot:services.workbench.snapshot,subscribe:(listener:()=>void)=>scope.add(services.workbench.subscribe(listener))}},hooks:{on:(event:string,listener:(payload:Json)=>void|Promise<void>)=>{if(!registering||typeof listener!=='function')throw Error('Invalid hook');const listeners=candidate.hooks.get(event)??new Set();listeners.add(listener);candidate.hooks.set(event,listeners);scope.add(()=>{listeners.delete(listener);});}},
      }));
      if(typeof cleanup==='function')scope.add(cleanup);
      return candidate;
    }catch(error){await scope.dispose().catch(this.report);throw error;}finally{registering=false;}
  }
  publish(candidate:AppRegistration):void {
    const id=candidate.identity.pluginId;
    const old=this.#active.get(id);
    if(old&&old.identity.generation>=candidate.identity.generation)throw Error('Stale App generation');
    this.#active.set(id,candidate);this.#changed();
    if(old)void old.scope.dispose().catch(this.report);
  }
  async unload(id:string):Promise<void>{const old=this.#active.get(id);if(!old)return;this.#active.delete(id);this.#changed();await old.scope.dispose().catch(this.report);}
  emit(event:string,payload:Json):void{for(const app of this.#active.values())for(const listener of app.hooks.get(event)??[])try{void Promise.resolve(listener(payload)).catch(this.report);}catch(error){this.report(error);}}
}

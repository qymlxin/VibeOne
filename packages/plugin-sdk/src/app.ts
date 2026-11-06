import {Scope,type Disposer} from './scope.js';
import type {Json} from './protocol.js';

export interface AppIdentity {pluginId:string; generation:number; version:string}
export interface AppPanelProps {workspaceId?:string; sessionId?:string}
export type AppComponent=(props:AppPanelProps)=>unknown;
export interface AppContext {
  readonly identity:Readonly<AppIdentity>;
  readonly scope:Scope;
  readonly config:Readonly<Record<string,Json>>;
  readonly panels:{register(id:string,component:AppComponent):void};
  readonly commands:{register(id:string,run:()=>void|Promise<void>):void};
  readonly settings:{register(id:string,component:AppComponent):void};
  readonly services:{workbench:{snapshot():Json; subscribe(listener:()=>void):Disposer}; invokeWorker(handler:string,input?:Json,workspaceId?:string):Promise<Json>};
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
        services:{...services,workbench:{snapshot:services.workbench.snapshot,subscribe:(listener:()=>void)=>scope.add(services.workbench.subscribe(listener))}},hooks:{on:(event:string,listener:(payload:Json)=>void|Promise<void>)=>{if(!registering||typeof listener!=='function')throw Error('Invalid hook');const listeners=candidate.hooks.get(event)??new Set();listeners.add(listener);candidate.hooks.set(event,listeners);scope.add(()=>{listeners.delete(listener);});}},
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

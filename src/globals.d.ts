interface D1Result<T=Record<string,unknown>> { results:T[] }
interface D1RunResult { meta:{changes?:number}; success?:boolean }
interface D1PreparedStatement { bind(...values:unknown[]):D1PreparedStatement; first<T=Record<string,unknown>>():Promise<T|null>; all<T=Record<string,unknown>>():Promise<D1Result<T>>; run():Promise<D1RunResult> }
interface D1Database { prepare(query:string):D1PreparedStatement }
interface Fetcher { fetch(request:Request):Promise<Response> }
interface Ai { run(model:string,input:Record<string,unknown>):Promise<unknown> }
interface ScheduledController {}
interface ExecutionContext { waitUntil(promise:Promise<unknown>):void }

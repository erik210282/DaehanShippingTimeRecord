// Enter the gated mode before Android has finished injecting its message bridge.
// The URL selects the layout only; no session is accepted from URL parameters.
export const nativeShipping = typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('nativeShipping') === '1';
export function postShippingMessage(message) {
  if (nativeShipping) {
    if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));
    else if(embeddedParentOrigin())window.parent.postMessage(message,embeddedParentOrigin());
  }
}
export async function saveShippingFile(blob, filename) {
  if (!nativeShipping) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return;
  }
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('File could not be read'));
    reader.readAsDataURL(blob);
  });
  const id = globalThis.crypto?.randomUUID?.() || String(Date.now());
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('daehan-native', receive); };
    const receive = event => {
      const data = event.detail;
      if (data?.type !== 'shipping:file-result' || data.id !== id) return;
      cleanup(); data.ok ? resolve() : reject(new Error(data.error || 'File could not be shared'));
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('File sharing timed out')); }, 120000);
    window.addEventListener('daehan-native', receive);
    postShippingMessage({ type: 'shipping:file', id, filename, mime: blob.type.split(';')[0], base64 });
  });
}

export function embeddedParentOrigin(){
 if(typeof window==='undefined'||window.parent===window)return null;
 try{const value=new URLSearchParams(window.location.search).get('parentOrigin'),u=new URL(value);
 const trusted=u.origin===window.location.origin||['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.protocol==='https:'&&(/\.(expo\.app|exp\.direct)$/.test(u.hostname));
 return trusted&&u.origin===value?u.origin:null;}catch{return null;}
}
if(typeof window!=='undefined')window.addEventListener('message',event=>{
 const origin=embeddedParentOrigin();
 if(!origin||event.origin!==origin||event.source!==window.parent)return;
 const data=event.data;if(!['shipping:session','shipping:language','shipping:file-result'].includes(data?.type))return;
 window.dispatchEvent(new CustomEvent('daehan-native',{detail:data}));
});

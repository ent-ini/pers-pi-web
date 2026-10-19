import { createGunzip, createBrotliDecompress, createInflate } from "node:zlib";
import { request } from 'node:https';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { publicAddress } from './model-gateway.mjs';
// Resolve once, reject private addresses, and pin this request's connection to
// the verified address. A second DNS lookup would allow rebinding after checks.
export async function providerFetch(target, options = {}) {
    const url = new URL(target);
    if (url.protocol !== 'https:')
        throw new Error('Invalid target');
    const addresses = await lookup(url.hostname, { all: true });
    if (!addresses.length || addresses.some(a => !publicAddress(a.address)))
        throw new Error('Invalid target');
    const address = addresses[0];
    return new Promise((resolve, reject) => {
        const req = request(url, { method: options.method, headers: Object.fromEntries(new Headers(options.headers)), signal: options.signal, lookup: (_host, opts, callback) => callback(null, opts.all ? [address] : address.address, address.family) }, res => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(res.headers))
                if (value !== undefined)
                    headers.set(key, Array.isArray(value) ? value.join(',') : value);
            let stream = res;
            const encoding = headers.get('content-encoding');
            const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : undefined;
            if (decoder) {
                stream = res.pipe(decoder);
                headers.delete('content-encoding');
                headers.delete('content-length');
            }
            resolve(new Response([204, 304].includes(res.statusCode) ? null : Readable.toWeb(stream), { status: res.statusCode, headers }));
        });
        req.on('error', reject);
        if (options.body)
            req.write(options.body);
        req.end();
    });
}

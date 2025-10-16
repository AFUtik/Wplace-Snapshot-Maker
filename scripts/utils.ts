import fs from 'fs/promises';
import path from "path"

// JSON //

export async function folderExists(folderPath: string) {
  try {
    const stats = await fs.stat(folderPath);
    return stats.isDirectory();
  } catch (err: any) {
    if (err.code === 'ENOENT') return false; 
    throw err; 
  }
}

export async function removeEmptyParents(dirPath: string, stopAt: string) {
  let current = dirPath;

  while (true) {
    if (path.resolve(current) === path.resolve(stopAt)) break;

    try {
      const files = await fs.readdir(current);
      if (files.length === 0) {
        await fs.rm(current, {recursive: true, force: true});
        console.log(`Removed empty directory: ${current}`);
        current = path.dirname(current);
      } else {
        break;
      }
    } catch (err) {
      console.error(`Error checking directory ${current}:`, err);
      break;
    }
  }
}

export async function readJson(filePath: string, options = { default: {}, createIfAbsent: false }) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(data);

    if (Object.keys(options.default).length !== 0) {
      for (const [key, value] of Object.entries(options.default)) {
        if (!(key in json)) {
          json[key] = value;
        }
      }
    }

    return json;
  } catch (err: any) {
    if (err.code === "ENOENT" && options.createIfAbsent) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({}, null, 2), "utf8");
    }
    return options.default;
  }
}

export async function writeJson(filePath: string, obj: Object) {
  try {
    const data = JSON.stringify(obj, null, 2);
    await fs.writeFile(filePath, data, 'utf8');
  } catch (err) {
    console.error('Failed to write JSON:', err);
  }
}

export async function downloadFileWithRetry(url: string): Promise<Buffer> {
  try {
    const res = await fetch(url);

    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after"); 
      const wait = (retryAfter ? parseInt(retryAfter, 10) * 1000 : 5000); // мс
      console.warn(`429 received. Retrying after ${wait}ms...`);
      await sleep(wait);
      return await downloadFileWithRetry(url);
    }

    if (!res.ok) {
      throw new Error(`Failed with status ${res.status}`);
    }

    return Buffer.from(await res.arrayBuffer());
  } catch (err: any) {
    console.error("Download error:", err.message);
    throw err;
  }
}


// Dates //

export function unixToFormatted(unixSeconds: number) {
  const d = new Date(unixSeconds * 1000);
  const pad = n => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formattedToUnix(formatted: string) {
  const [datePart, timePart] = formatted.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);
  
  const d = new Date(year, month - 1, day, hours, minutes, seconds);
  return Math.floor(d.getTime() / 1000);
}

// other //

// x and y don't exceed 2048 due to world's restrictions. //
export function hash_xy(x: number, y: number) {return (x << 11) | y;}

// z <= 32 //
export function hash_zxy(z: number, x: number, y: number) {return (z << 22) | (x << 11) | y}

export function sleep(ms: number) {return new Promise(resolve => setTimeout(resolve, ms));}
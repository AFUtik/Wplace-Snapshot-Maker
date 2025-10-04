import fs from 'fs/promises';
import path from "path"

// JSON //

export async function folderExists(folderPath) {
  try {
    const stats = await fs.stat(folderPath);
    return stats.isDirectory();
  } catch (err) {
    if (err.code === 'ENOENT') return false; 
    throw err; 
  }
}

export async function removeEmptyParents(dirPath, stopAt) {
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

export async function readJson(filePath, options = { default: {}, createIfAbsent: false }) {
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
  } catch (err) {
    if (err.code === "ENOENT" && options.createIfAbsent) {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify({}, null, 2), "utf8");
    }
    return options.default;
  }
}

export async function writeJson(filePath, obj) {
  try {
    const data = JSON.stringify(obj, null, 2);
    await fs.writeFile(filePath, data, 'utf8');
  } catch (err) {
    console.error('Failed to write JSON:', err);
  }
}

export async function downloadFileWithRetry(url) {
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
  } catch (err) {
    console.error("Download error:", err.message);
    throw err;
  }
}


// Dates //

export function pathToDate(p) {
  const [year, month, day, hour, minute] = p.trim().split(/\/+/);
  return new Date(year, month - 1, day, hour, minute);
}

export function pathToFormatted(p) {
  const [year, month, day, hour, minute] = p.trim().split(/\/+/);
  return `${month}/${day}/${year}-${hour}:${minute}`;
}

export function formattedToPath(p) {
  const [month, day, year, hour, minute] = p.trim().split(/[\:-\s/]+/);
  return `${year}/${month}/${day}/${hour}/${minute}`;
}

export function dateToPath(d) {
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}/${String(d.getHours()).padStart(2,'0')}/${String(d.getMinutes()).padStart(2,'0')}`
}

export function dateToFormatted(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}-${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}

// other //

export function sleep(ms) {return new Promise(resolve => setTimeout(resolve, ms));}
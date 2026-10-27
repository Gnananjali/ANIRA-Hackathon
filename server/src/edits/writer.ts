import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Writes through a temporary file in the same directory, then renames over the
 * target. The temporary file is always removed if any step fails.
 */
export async function writeFileAtomic(target: string, data: Buffer): Promise<void> {
  const directory = path.dirname(target);
  const temporary = path.join(directory, `.anira-edit-${randomUUID()}.tmp`);

  try {
    const handle = await fs.open(temporary, 'wx');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
/* SPDX-License-Identifier: Apache-2.0 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { imageSize } from 'image-size';
import type { AppConfig } from '../config.js';
import { all, get, run, transaction, type DB } from '../db.js';
import type { ContentKind, ContentRow } from '../types.js';
import { asTrimmed, id, isHttpUrl, nowIso } from '../util.js';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.ogg']);

export function contentDto(content: ContentRow): ContentRow & { url: string | null } {
  return {
    ...content,
    url:
      content.kind === 'url'
        ? content.external_url
        : content.stored_name
          ? `/media/${encodeURIComponent(content.stored_name)}`
          : null,
  };
}

function sniffFile(filePath: string, kind: ContentKind): boolean {
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(64);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
  } finally {
    fs.closeSync(descriptor);
  }
  const header = buffer.subarray(0, bytesRead);
  if (kind === 'image') {
    const png = header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const jpeg = header.length > 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const gif = header.subarray(0, 6).toString('ascii') === 'GIF87a' || header.subarray(0, 6).toString('ascii') === 'GIF89a';
    const webp =
      header.length > 12 &&
      header.subarray(0, 4).toString('ascii') === 'RIFF' &&
      header.subarray(8, 12).toString('ascii') === 'WEBP';
    return png || jpeg || gif || webp;
  }
  if (kind === 'video') {
    const mp4 = header.length > 12 && header.subarray(4, 8).toString('ascii') === 'ftyp';
    const webm = header.length > 4 && header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    const ogg = header.subarray(0, 4).toString('ascii') === 'OggS';
    return mp4 || webm || ogg;
  }
  return true;
}

function removeQuietly(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // File may already be gone.
  }
}

export function contentRoutes(db: DB, config: AppConfig): Router {
  const router = Router();
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, config.uploadDir),
    filename: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const extensionMap: Record<string, string> = { '.jpeg': '.jpg', '.m4v': '.mp4', '.ogv': '.ogv', '.ogg': '.ogg' };
      const safeExtension = extensionMap[extension] || extension;
      callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${safeExtension}`);
    },
  });

  const upload = multer({
    storage,
    limits: { files: 20, fileSize: config.maxUploadBytes },
    fileFilter: (_req, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      const isImage = IMAGE_MIME.has(file.mimetype) && IMAGE_EXT.has(extension);
      const isVideo = VIDEO_MIME.has(file.mimetype) && VIDEO_EXT.has(extension);
      if (!isImage && !isVideo) {
        callback(new Error('지원하지 않는 파일 형식입니다. JPEG, PNG, WebP, GIF, MP4, WebM, OGG만 올릴 수 있습니다.'));
        return;
      }
      callback(null, true);
    },
  });

  router.get('/', (req, res) => {
    const kind = typeof req.query.kind === 'string' ? req.query.kind : '';
    const rows =
      kind === 'image' || kind === 'video' || kind === 'url'
        ? all<ContentRow>(db, 'SELECT * FROM contents WHERE kind = ? ORDER BY created_at DESC', kind)
        : all<ContentRow>(db, 'SELECT * FROM contents ORDER BY created_at DESC');
    res.json({ contents: rows.map(contentDto) });
  });

  router.post('/', upload.array('files', 20), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) {
      res.status(400).json({ error: '업로드할 파일을 선택해 주세요.' });
      return;
    }
    const prepared: Array<{
      file: Express.Multer.File;
      kind: ContentKind;
      dimensions: { width?: number; height?: number };
    }> = [];
    try {
      for (const file of files) {
        const kind: ContentKind = IMAGE_MIME.has(file.mimetype) ? 'image' : 'video';
        if (!sniffFile(file.path, kind)) {
          throw new Error(`${file.originalname} 파일의 실제 형식이 확장자와 다릅니다.`);
        }
        let dimensions: { width?: number; height?: number } = {};
        if (kind === 'image') {
          dimensions = imageSize(fs.readFileSync(file.path));
          if (!dimensions.width || !dimensions.height) throw new Error(`${file.originalname} 이미지 크기를 읽지 못했습니다.`);
        }
        prepared.push({ file, kind, dimensions });
      }
    } catch (error) {
      for (const file of files) removeQuietly(file.path);
      res.status(400).json({ error: error instanceof Error ? error.message : '파일 검사에 실패했습니다.' });
      return;
    }

    const createdAt = nowIso();
    const inserted: ContentRow[] = [];
    transaction(db, () => {
      for (const item of prepared) {
        const contentId = id();
        const displayName = path.basename(item.file.originalname, path.extname(item.file.originalname)).slice(0, 200) || item.file.originalname;
        run(
          db,
          `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, ?)`,
          contentId,
          displayName,
          item.kind,
          item.file.mimetype,
          item.file.filename,
          item.file.size,
          item.dimensions.width ?? null,
          item.dimensions.height ?? null,
          createdAt,
        );
        const row = get<ContentRow>(db, 'SELECT * FROM contents WHERE id = ?', contentId);
        if (row) inserted.push(row);
      }
    });
    res.status(201).json({ contents: inserted.map(contentDto) });
  });

  router.post('/url', (req, res) => {
    const name = asTrimmed(req.body?.name, 200);
    const url = asTrimmed(req.body?.url, 2000);
    if (!name) {
      res.status(400).json({ error: '콘텐츠 이름을 입력해 주세요.' });
      return;
    }
    if (!isHttpUrl(url)) {
      res.status(400).json({ error: 'http:// 또는 https://로 시작하는 주소를 입력해 주세요.' });
      return;
    }
    const contentId = id();
    run(
      db,
      `INSERT INTO contents(id, name, kind, mime, stored_name, external_url, file_size, width, height, checksum, created_at)
       VALUES (?, ?, 'url', NULL, NULL, ?, NULL, NULL, NULL, NULL, ?)`,
      contentId,
      name,
      url,
      nowIso(),
    );
    const row = get<ContentRow>(db, 'SELECT * FROM contents WHERE id = ?', contentId);
    res.status(201).json({ content: row ? contentDto(row) : null });
  });

  router.patch('/:id', (req, res) => {
    const content = get<ContentRow>(db, 'SELECT * FROM contents WHERE id = ?', req.params.id);
    if (!content) {
      res.status(404).json({ error: '콘텐츠를 찾을 수 없습니다.' });
      return;
    }
    const name = asTrimmed(req.body?.name, 200);
    if (!name) {
      res.status(400).json({ error: '콘텐츠 이름을 입력해 주세요.' });
      return;
    }
    run(db, 'UPDATE contents SET name = ? WHERE id = ?', name, content.id);
    const updated = get<ContentRow>(db, 'SELECT * FROM contents WHERE id = ?', content.id);
    res.json({ content: updated ? contentDto(updated) : null });
  });

  router.delete('/:id', (req, res) => {
    const content = get<ContentRow>(db, 'SELECT * FROM contents WHERE id = ?', req.params.id);
    if (!content) {
      res.status(404).json({ error: '콘텐츠를 찾을 수 없습니다.' });
      return;
    }
    const used = all<{ name: string }>(
      db,
      `SELECT DISTINCT p.name
         FROM playlist_items pi
         JOIN playlists p ON p.id = pi.playlist_id
        WHERE pi.content_id = ?`,
      content.id,
    );
    if (used.length > 0) {
      res.status(409).json({
        error: `이 콘텐츠는 ${used.map((row) => `‘${row.name}’`).join(', ')} 재생목록에서 사용 중입니다. 먼저 재생목록에서 빼 주세요.`,
      });
      return;
    }
    run(db, 'DELETE FROM contents WHERE id = ?', content.id);
    if (content.stored_name) removeQuietly(path.join(config.uploadDir, content.stored_name));
    res.json({ ok: true });
  });

  return router;
}

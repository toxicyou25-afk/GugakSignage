/* SPDX-License-Identifier: Apache-2.0 */
import { Buffer } from 'node:buffer';

function readSecret(prompt: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || !process.stdout.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error('대화형 터미널에서 실행해야 비밀번호를 안전하게 입력할 수 있습니다.'));
  }

  process.stdout.write(prompt);
  input.setEncoding('utf8');
  input.setRawMode(true);
  input.resume();

  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error?: Error) => {
      input.off('data', onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk: string | Buffer) => {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish(new Error('취소했습니다.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          value = Array.from(value).slice(0, -1).join('');
        } else if (character >= ' ') {
          value += character;
        }
      }
    };
    input.on('data', onData);
  });
}

async function postJson(url: string, body: unknown, cookie?: string): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function main(): Promise<void> {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 설정이 올바르지 않습니다.');
  const baseUrl = `http://127.0.0.1:${port}`;
  const currentPassword = await readSecret('현재 관리자 비밀번호: ');
  const newPassword = await readSecret('새 관리자 비밀번호(8~128자): ');
  const confirmPassword = await readSecret('새 관리자 비밀번호 확인: ');
  if (newPassword !== confirmPassword) throw new Error('새 비밀번호 확인이 일치하지 않습니다.');

  const login = await postJson(`${baseUrl}/api/auth/login`, { password: currentPassword });
  if (!login.ok) throw new Error('로그인에 실패했습니다. 비밀번호를 확인하세요.');
  const setCookie = login.headers.get('set-cookie');
  const cookie = setCookie?.split(';', 1)[0];
  if (!cookie) throw new Error('세션 쿠키를 받지 못했습니다.');

  const change = await postJson(`${baseUrl}/api/auth/change-password`, {
    currentPassword,
    newPassword,
    confirmPassword,
  }, cookie);
  if (!change.ok) {
    const result = await change.json().catch(() => null) as { error?: string } | null;
    throw new Error(result?.error || '비밀번호 변경에 실패했습니다.');
  }
  console.log('관리자 비밀번호를 변경했고 기존 세션을 무효화했습니다. 서버가 LAN을 사용하도록 설정되어 있으면 이제 LAN 관리를 사용할 수 있습니다. HOST·포트 공개와 방화벽 설정을 확인하세요.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '비밀번호 변경에 실패했습니다.');
  process.exitCode = 1;
});

/**
 * 任務面板以網址參數 `?task=<id>` 開啟：今日、待補摘要、日誌三頁一致，
 * 重新整理或分享網址都會停在同一個任務。
 */
import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useOpenTask(): [string | null, (id: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const openId = params.get('task');
  const setOpen = useCallback(
    (id: string | null) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (id) p.set('task', id);
          else p.delete('task');
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );
  return [openId, setOpen];
}

import {
  Cloud,
  CloudOff,
  PencilLine,
  RotateCcw,
  Trash2,
  Users,
  Wifi,
  Zap,
} from 'lucide-react';
import { SimScenario } from '../store';
import type { RepoAction } from '../store';

export default function SimPanel({
  online,
  failNext,
  dispatch,
  onOpenTrash,
  trashCount,
}: {
  online: boolean;
  failNext: boolean;
  dispatch: React.Dispatch<RepoAction>;
  onOpenTrash: () => void;
  trashCount: number;
}) {
  const sim = (scenario: SimScenario) => dispatch({ type: 'simRemote', scenario });
  return (
    <div className="sim-panel">
      <div className="sim-title">
        <Users size={13}/> 同步演练台
      </div>

      <button
        className={`net-toggle ${online ? 'on' : 'off'}`}
        onClick={() => dispatch({ type: 'setOnline', online: !online })}
      >
        {online ? <Wifi size={14}/> : <CloudOff size={14}/>}
        {online ? '联网中 — 点击切到离线' : '离线中 — 点击回网'}
      </button>

      <div className="sim-group">
        <small>模拟另一位设计师改远端库</small>
        <button onClick={() => sim('different-field')} title="本机改分类、同事改正文字体">
          <PencilLine size={12}/> 同事改 p1 正文字体（不同字段）
        </button>
        <button onClick={() => sim('same-field')} title="两边同时改同一配对的分类">
          <PencilLine size={12}/> 同事改 p1 分类+名称（同字段冲突）
        </button>
        <button onClick={() => sim('rename-category')} title="分类被重命名，成员归属对不上">
          <PencilLine size={12}/> 同事重命名「Brand voice」分类
        </button>
        <button onClick={() => sim('delete-pair')} title="远端删除，本地若有改动进回收站">
          <Trash2 size={12}/> 同事远端删除 p1
        </button>
      </div>

      <div className="sim-group">
        <small>故障演练</small>
        <label className="check-row">
          <input
            type="checkbox"
            checked={failNext}
            onChange={(e) => dispatch({ type: 'setFailNext', value: e.target.checked })}
          />
          <Zap size={12}/> 下次回网合并失败（验证原批次重试）
        </label>
      </div>

      <div className="sim-foot">
        <button onClick={onOpenTrash}>
          <Cloud size={12}/> 回收站{trashCount > 0 && <b>{trashCount}</b>}
        </button>
        <button
          className="reset"
          onClick={() => dispatch({ type: 'resetDemo' })}
          title="恢复演示初始数据"
        >
          <RotateCcw size={12}/> 重置
        </button>
      </div>
    </div>
  );
}

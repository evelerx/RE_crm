import { KeyboardEvent } from "react";

import { MarketingRequestDetail } from "../../types/marketing";
import TeamThread from "./TeamThread";

type Props = {
  role: "owner" | "manager";
  requestDetail: MarketingRequestDetail | null;
  threadComment: string;
  setThreadComment: (value: string) => void;
  handleCommentKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  sendThreadComment: () => void;
  open: boolean;
  onToggle: () => void;
};

export default function MessageCenter({
  role,
  requestDetail,
  threadComment,
  setThreadComment,
  handleCommentKeyDown,
  sendThreadComment,
  open,
  onToggle,
}: Props) {
  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">Message center</div>
          <div className="marketingPromptPanelTitle">{requestDetail?.request_code || "Owner conversation"}</div>
        </div>
        <button className="btn ghost" type="button" onClick={onToggle}>
          {open ? "Collapse" : "Expand"}
        </button>
      </div>
      {open ? (
        <TeamThread
          title={requestDetail?.project_name || "Owner request"}
          role={role}
          comments={requestDetail?.comments || []}
          value={threadComment}
          onChange={setThreadComment}
          onSend={sendThreadComment}
          onKeyDown={handleCommentKeyDown}
        />
      ) : null}
    </section>
  );
}

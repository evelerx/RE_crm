import { KeyboardEvent } from "react";

import { Comment } from "../../types/marketing";

type Props = {
  title: string;
  role: "owner" | "manager";
  comments: Comment[];
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export default function TeamThread({ title, role, comments, value, onChange, onSend, onKeyDown }: Props) {
  return (
    <section className="marketingPromptPanel">
      <div className="marketingPromptPanelHeader">
        <div>
          <div className="marketingPromptLabel">{role === "owner" ? "Owner thread" : "Team thread"}</div>
          <div className="marketingPromptPanelTitle">{title}</div>
        </div>
      </div>
      <div className="marketingCommentsThread">
        {comments.length === 0 ? <div className="muted">No messages yet.</div> : null}
        {comments.map((comment) => (
          <div key={comment.id} className={`marketingCommentBubble ${comment.sender_role === "owner" ? "outbound" : "inbound"}`}>
            <div className="marketingCommentMeta">{comment.sender_name}</div>
            <div>{comment.message}</div>
            <div className="marketingCommentMeta">{formatDateTime(comment.created_at)}</div>
          </div>
        ))}
      </div>
      <div className="marketingCommentComposer">
        <textarea className="textarea" value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Reply..." />
        <button className="btn" type="button" onClick={onSend}>
          Send
        </button>
      </div>
    </section>
  );
}

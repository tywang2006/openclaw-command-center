export interface MentionMatch {
  deptId: string;
  deptName: string;
  raw: string;
}

export function detectMentions(
  text: string,
  departments: Array<{ id: string; name: string }>,
  currentDeptId: string
): MentionMatch[] {
  const mentionPattern = /@([\w\u4e00-\u9fff]+)/g;
  const matches: MentionMatch[] = [];
  let m: RegExpExecArray | null;
  while ((m = mentionPattern.exec(text)) !== null) {
    const mention = m[1];
    const dept = departments.find(
      d => d.id !== currentDeptId && (d.id === mention || d.name === mention)
    );
    if (dept) matches.push({ deptId: dept.id, deptName: dept.name, raw: m[0] });
  }
  return matches;
}

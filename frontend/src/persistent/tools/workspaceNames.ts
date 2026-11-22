interface NamedWorkspace {
  id: string;
  name: string;
}

export function workspaceOption(
  space: NamedWorkspace,
  spaces: readonly NamedWorkspace[],
) {
  const others = spaces.filter(
    (other) => other.id !== space.id && other.name === space.name,
  );
  if (!others.length) return space.name;
  let length = 8;
  while (
    length < space.id.length &&
    others.some((other) => other.id.startsWith(space.id.slice(0, length)))
  )
    length++;
  return space.name + " · " + space.id.slice(0, length);
}

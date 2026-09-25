interface Props {
  name: string;
  playerId: number;
  onSelect: (id: number) => void;
}

export default function PlayerName({ name, playerId, onSelect }: Props) {
  return (
    <button type="button" className="player-link text-left" onClick={() => onSelect(playerId)}>
      {name}
    </button>
  );
}

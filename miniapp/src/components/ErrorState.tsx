interface Props {
  message: string;
  onRetry?: () => void;
}

export default function ErrorState({ message, onRetry }: Props) {
  return (
    <div className="card text-center">
      <p className="text-tg-hint mb-3">{message}</p>
      {onRetry && (
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-tg-button text-tg-button-text text-sm"
          onClick={onRetry}
        >
          Повторить
        </button>
      )}
    </div>
  );
}

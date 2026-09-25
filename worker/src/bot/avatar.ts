import type { Api } from 'grammy';

export async function telegramProfileAvatarFileId(api: Api, userId: number): Promise<string | null> {
  const photos = await api.getUserProfilePhotos(userId, { limit: 1 });
  if (!photos.photos.length) return null;
  const sizes = photos.photos[0];
  return sizes[sizes.length - 1].file_id;
}

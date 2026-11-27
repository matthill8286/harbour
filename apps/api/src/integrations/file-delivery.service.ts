import {
  BadRequestException,
  Injectable,
  Logger,
  StreamableFile,
  UnprocessableEntityException,
} from '@nestjs/common';
import { contentDisposition, withExtension } from '../common/file-names';
import {
  inPictureQueue,
  isPicture,
  render,
  renditionType,
  UnreadablePicture,
  type Variant,
} from './image-renditions';
import { StorageService, type Companion } from './storage.service';

/** A stored upload, as its database row describes it. */
export type StoredFile = {
  organisationId: string;
  storageKey: string;
  mimeType: string;
  name: string;
};

const VARIANTS: Variant[] = ['thumb', 'display', 'clean'];

/** Raise the number when the copies must be made again. */
const suffixFor = (mimeType: string, variant: Variant) =>
  `.v1.${variant}.${renditionType(mimeType, variant).extension}`;

/** Every suffix a file's copies can have. */
const suffixesOf = (mimeType: string) =>
  isPicture(mimeType)
    ? VARIANTS.map((variant) => suffixFor(mimeType, variant))
    : [];

/** The name and type a copy is sent under. */
export function renditionOf(
  file: { name: string; mimeType: string },
  variant: Variant,
) {
  const { mimeType, extension } = renditionType(file.mimeType, variant);
  const keepName =
    mimeType === file.mimeType && /\.(jpe?g|png|webp|tiff?)$/i.test(file.name);
  return {
    mimeType,
    name: keepName ? file.name : withExtension(file.name, extension),
  };
}

@Injectable()
export class FileDeliveryService {
  private readonly logger = new Logger(FileDeliveryService.name);

  constructor(private readonly storage: StorageService) {}

  /**
   * The copies made as a photo is uploaded. A photo that cannot be read is
   * refused here, before anything is written.
   */
  async photoCopies(buffer: Buffer, mimeType: string): Promise<Companion[]> {
    const variants: Variant[] = ['display', 'thumb'];
    try {
      const copies = await inPictureQueue(() =>
        render(buffer, mimeType, variants),
      );
      return variants.map((variant, index) => ({
        suffix: suffixFor(mimeType, variant),
        bytes: copies[index],
      }));
    } catch (error) {
      if (!(error instanceof UnreadablePicture)) throw error;
      this.logger.warn(
        `A ${mimeType} upload could not be read: ${error.message}`,
      );
      throw new BadRequestException(
        'This photo could not be read. Save it as a JPEG and try again.',
      );
    }
  }

  /** The file exactly as it was uploaded. */
  async original(
    file: StoredFile,
    disposition: 'inline' | 'attachment',
  ): Promise<StreamableFile> {
    const { stream, size } = await this.storage.stream(
      file.storageKey,
      file.organisationId,
    );
    return new StreamableFile(stream, {
      type: file.mimeType,
      length: size,
      disposition: contentDisposition(disposition, file.name),
    });
  }

  /**
   * A copy without metadata. A photo stored before copies were made gets its
   * copy the first time it is asked for. This never falls back to the original.
   */
  async copy(
    file: StoredFile,
    variant: Variant,
    disposition: 'inline' | 'attachment',
  ): Promise<StreamableFile> {
    const { mimeType, name } = renditionOf(file, variant);
    const headers = {
      type: mimeType,
      disposition: contentDisposition(disposition, name),
    };
    const suffix = suffixFor(file.mimeType, variant);
    const key = file.storageKey + suffix;
    if (!(await this.storage.exists(key, file.organisationId))) {
      const made = await this.make(file, variant, suffix);
      if (made) return new StreamableFile(made, headers);
    }
    const { stream, size } = await this.storage.stream(
      key,
      file.organisationId,
    );
    return new StreamableFile(stream, { ...headers, length: size });
  }

  /** Deletes an upload and every copy of it. */
  remove(file: Omit<StoredFile, 'name'>): Promise<void> {
    return this.storage.remove(
      file.storageKey,
      file.organisationId,
      suffixesOf(file.mimeType),
    );
  }

  /**
   * Makes and keeps a missing copy. Returns its bytes if it was made now, or
   * nothing if another request made it while this one waited its turn.
   */
  private make(
    file: StoredFile,
    variant: Variant,
    suffix: string,
  ): Promise<Buffer | null> {
    return inPictureQueue(async () => {
      const { storageKey, organisationId, mimeType } = file;
      if (await this.storage.exists(storageKey + suffix, organisationId)) {
        return null;
      }
      const original = await this.storage.read(storageKey, organisationId);
      let bytes: Buffer;
      try {
        [bytes] = await render(original, mimeType, [variant]);
      } catch (error) {
        if (!(error instanceof UnreadablePicture)) throw error;
        this.logger.warn(`No copy of ${storageKey}: ${error.message}`);
        throw new UnprocessableEntityException(
          'This picture cannot be prepared for viewing.',
        );
      }
      try {
        await this.storage.saveCompanion(
          storageKey,
          { suffix, bytes },
          organisationId,
        );
      } catch (error) {
        // A full disk must not stop anyone from seeing a photo.
        this.logger.warn(`Copy not kept: ${(error as Error).message}`);
      }
      return bytes;
    });
  }
}

import { documentToHtmlString } from '@contentful/rich-text-html-renderer';
import log from 'loglevel';
import type { Entry, Asset } from 'contentful';
import type {
  FeatureAnnouncementRawNotification,
  TypeFeatureAnnouncement,
} from '../types/feature-announcement/feature-announcement';
import type { Notification } from '../types/notification/notification';
import { processFeatureAnnouncement } from '../processors/process-feature-announcement';
import { TRIGGER_TYPES } from '../constants/notification-schema';
import { ImageFields } from '../types/feature-announcement/type-feature-announcement';
import { TypeExtensionLinkFields } from '../types/feature-announcement/type-extension-link';

const spaceId = process.env.CONTENTFUL_ACCESS_SPACE_ID || ':space_id';
const accessToken = process.env.CONTENTFUL_ACCESS_TOKEN || '';
export const FEATURE_ANNOUNCEMENT_API = `https://cdn.contentful.com/spaces/${spaceId}/environments/master/entries`;
export const FEATURE_ANNOUNCEMENT_URL = `${FEATURE_ANNOUNCEMENT_API}?access_token=${accessToken}&content_type=productAnnouncement&include=10&fields.clients=extension`;

export type ContentfulResult = {
  includes?: {
    Entry?: Entry[];
    Asset?: Asset[];
  };
  items?: TypeFeatureAnnouncement[];
};

async function fetchFromContentful(
  url: string,
  retries = 1,
  retryDelay = 1000,
): Promise<ContentfulResult | null> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Fetch failed with status: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error instanceof Error) {
        lastError = error;
      }
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }

  log.error(
    `Error fetching from Contentful after ${retries} retries: ${lastError}`,
  );
  return null;
}

async function fetchFeatureAnnouncementNotifications(): Promise<
  FeatureAnnouncementRawNotification[]
> {
  const data = await fetchFromContentful(FEATURE_ANNOUNCEMENT_URL);

  if (!data) {
    return [];
  }

  const findIncludedItem = (sysId: string) => {
    const item =
      data?.includes?.Entry?.find((i: Entry) => i?.sys?.id === sysId) ||
      data?.includes?.Asset?.find((i: Asset) => i?.sys?.id === sysId);
    return item ? item?.fields : null;
  };

  const contentfulNotifications = data?.items ?? [];
  const rawNotifications: FeatureAnnouncementRawNotification[] =
    contentfulNotifications.map((n: TypeFeatureAnnouncement) => {
      const { fields } = n;
      const imageFields = fields.image
        ? (findIncludedItem(fields.image.sys.id) as ImageFields['fields'])
        : undefined;
      const extensionLinkFields = fields.extensionLink
        ? (findIncludedItem(
            fields.extensionLink.sys.id,
          ) as TypeExtensionLinkFields['fields'])
        : undefined;

      const notification: FeatureAnnouncementRawNotification = {
        type: TRIGGER_TYPES.FEATURES_ANNOUNCEMENT,
        createdAt: new Date(n.sys.createdAt).toString(),
        data: {
          id: fields.id,
          category: fields.category,
          title: fields.title,
          longDescription: documentToHtmlString(fields.longDescription),
          shortDescription: fields.shortDescription,
          image: {
            title: imageFields?.title,
            description: imageFields?.description,
            url: imageFields?.file?.url ?? '',
          },
          extensionLink: extensionLinkFields && {
            extensionLinkText: extensionLinkFields?.extensionLinkText,
            extensionLinkRoute: extensionLinkFields?.extensionLinkRoute,
          },
        },
      };

      return notification;
    });

  return rawNotifications;
}

export async function getFeatureAnnouncementNotifications(): Promise<
  Notification[]
> {
  if (
    process.env.CONTENTFUL_ACCESS_SPACE_ID &&
    process.env.CONTENTFUL_ACCESS_TOKEN
  ) {
    const rawNotifications = await fetchFeatureAnnouncementNotifications();
    const notifications = rawNotifications.map((notification) =>
      processFeatureAnnouncement(notification),
    );

    return notifications;
  }

  return [];
}

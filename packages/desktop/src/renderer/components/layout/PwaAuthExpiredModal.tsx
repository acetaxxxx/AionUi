import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Modal, Typography } from '@arco-design/web-react';
import { Lock, Refresh } from '@icon-park/react';
import usePwaMode from '@renderer/hooks/system/usePwaMode';
import { useAuth } from '@renderer/hooks/context/AuthContext';

const { Text, Title } = Typography;

export const PwaAuthExpiredModal: React.FC = () => {
  const { t } = useTranslation();
  const isPwa = usePwaMode();
  const { status } = useAuth();

  const handleSsoReload = useCallback(() => {
    if (typeof window !== 'undefined') {
      const isCfAccess = document.cookie.includes('CF_Authorization');
      if (isCfAccess) {
        window.location.href = '/cdn-cgi/access/logout';
      } else {
        window.location.href = window.location.origin;
      }
    }
  }, []);

  if (!isPwa || status !== 'unauthenticated') {
    return null;
  }

  return (
    <Modal
      visible
      closable={false}
      maskClosable={false}
      footer={null}
      alignCenter
      style={{ maxWidth: 400, borderRadius: 12 }}
    >
      <div style={{ textAlign: 'center', padding: '16px 8px' }}>
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: 'var(--color-fill-2, #f2f3f5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px auto',
          }}
        >
          <Lock theme='outline' size='28' fill='var(--color-text-1, #1d2129)' />
        </div>
        <Title heading={5} style={{ marginTop: 0, marginBottom: 8 }}>
          {t('login.pwaSessionExpiredTitle')}
        </Title>
        <Text type='secondary' style={{ display: 'block', marginBottom: 24, fontSize: 14 }}>
          {t('login.pwaSessionExpiredDesc')}
        </Text>
        <Button
          type='primary'
          size='large'
          long
          icon={<Refresh theme='outline' size='16' />}
          onClick={handleSsoReload}
          style={{ borderRadius: 8 }}
        >
          {t('login.pwaSessionExpiredButton')}
        </Button>
      </div>
    </Modal>
  );
};

export default PwaAuthExpiredModal;

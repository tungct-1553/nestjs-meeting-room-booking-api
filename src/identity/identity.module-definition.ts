import { ConfigurableModuleBuilder } from '@nestjs/common';

export interface IdentityOptions {
  issuer: string;
  apiClientId: string;
}

export const { ConfigurableModuleClass, MODULE_OPTIONS_TOKEN: IDENTITY_OPTIONS } =
  new ConfigurableModuleBuilder<IdentityOptions>({ moduleName: 'Identity' }).build();

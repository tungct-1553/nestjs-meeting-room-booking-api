import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { Public } from '../identity/decorators/public.decorator';
import { HealthService } from './health.service';

@Public()
@ApiTags('health')
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get()
  live() { return { status: 'ok' }; }
  @Get('ready')
  ready() { return this.health.ready(); }
}

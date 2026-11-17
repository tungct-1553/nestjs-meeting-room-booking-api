import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RawResponse } from '../common/http/decorators/raw-response.decorator';
import { Public } from '../identity/public/http/public.decorator';
import { HealthService } from './health.service';

@Public()
@ApiTags('health')
@RawResponse()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get()
  live(): { status: string } {
    return { status: 'ok' };
  }
  @Get('ready')
  ready(): Promise<{ status: string }> {
    return this.health.ready();
  }
}

import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import {
  INCIDENT_STATES,
  getComponentDefinitions,
} from './constants/status-components';
import { CreateIncidentDto } from './dto/create-incident.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { StatusStoreService } from './status-store.service';

@Controller('status')
@UseGuards(AdminGuard)
export class StatusAdminController {
  constructor(private readonly store: StatusStoreService) {}

  @Post('incidents')
  async create(@Body() body: CreateIncidentDto) {
    const component = String(body.component || '')
      .trim()
      .slice(0, 80);
    const definition = getComponentDefinitions().find(
      (item) => item.id === component,
    );
    const title = String(body.title || '')
      .trim()
      .slice(0, 160);
    const description = String(body.description || '')
      .trim()
      .slice(0, 1000);
    if (!definition || !title || !description) {
      throw new BadRequestException(
        'component, title, and description are required',
      );
    }
    const status = (INCIDENT_STATES as readonly string[]).includes(
      String(body.status || ''),
    )
      ? String(body.status)
      : 'investigating';
    const incident = await this.store.createManualIncident({
      component,
      status,
      severity: String(body.severity || 'warning')
        .trim()
        .slice(0, 30),
      title,
      description,
    });
    return { ok: true, incident };
  }

  @Patch('incidents/:id')
  async update(@Param('id') idRaw: string, @Body() body: UpdateIncidentDto) {
    const id = String(idRaw || '')
      .trim()
      .slice(0, 180);
    if (!id || id.includes('/')) {
      throw new BadRequestException('Invalid incident id');
    }
    const status = (INCIDENT_STATES as readonly string[]).includes(
      String(body.status || ''),
    )
      ? String(body.status)
      : null;
    const message = String(body.message || '')
      .trim()
      .slice(0, 1000);
    if (!status && !message) {
      throw new BadRequestException('status or message is required');
    }
    const incident = await this.store.updateManualIncident(id, {
      status,
      message: message || undefined,
    });
    if (!incident) throw new NotFoundException('Incident not found');
    return { ok: true, incident };
  }
}

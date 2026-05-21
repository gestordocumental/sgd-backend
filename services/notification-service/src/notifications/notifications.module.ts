import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationsConsumer } from './notifications.consumer';
import { EmailService } from './email/email.service';
import { UserClientService } from './user-client/user-client.service';
import { AppLogger } from '../common/logger/app-logger.service';
import { KAFKA_CLIENT } from '../common/kafka/kafka.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification]),
    HttpModule,
  ],
  controllers: [NotificationsController],
  providers: [
    AppLogger,
    NotificationsService,
    NotificationsConsumer,
    EmailService,
    UserClientService,
    {
      provide: KAFKA_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Kafka({
          clientId: config.getOrThrow<string>('KAFKA_CLIENT_ID'),
          brokers:  [config.getOrThrow<string>('KAFKA_BROKER')],
        }),
    },
  ],
})
export class NotificationsModule {}

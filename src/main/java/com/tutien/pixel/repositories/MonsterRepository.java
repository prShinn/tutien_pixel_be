package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.monsterEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface MonsterRepository extends JpaRepository<monsterEntity, Integer> {
    Optional<monsterEntity> findByCode(String code);
}

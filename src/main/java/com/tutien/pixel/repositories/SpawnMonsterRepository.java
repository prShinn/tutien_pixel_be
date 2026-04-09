package com.tutien.pixel.repositories;

import com.tutien.pixel.entities.spawnMonsterEntity;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SpawnMonsterRepository extends JpaRepository<spawnMonsterEntity, Integer> {
    List<spawnMonsterEntity> findByMapCode(String mapCode);
}
